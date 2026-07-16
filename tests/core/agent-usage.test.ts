import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import type { AgentRuntimeAdapter, RuntimeMemoryEntry } from '@bakin/core/adapters/runtime'

// Pure parser + mock-adapter tests — no filesystem I/O — but the isolation
// mocks are mandatory belt-and-braces so a future change here can never
// touch ~/.bakin/.
const testDir = join(tmpdir(), `bakin-test-agent-usage-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import {
  getAgentUsageSnapshot,
  getAllAgentUsage,
  parseSessionUsageContent,
  parseSessionUsageMessages,
} from '../../src/core/agent-usage'

interface FixtureSession {
  agentId: string
  id: string
  content: string
  updatedAt?: string
  path?: string
}

const SESSION_TIER = 'runtime-session-jsonl'

let sessions: FixtureSession[]

function makeRuntime(): AgentRuntimeAdapter {
  const runtime = createMockRuntimeAdapter()
  runtime.agents.list = async () => {
    const ids = [...new Set(sessions.map((session) => session.agentId))]
    return ids.map((id) => ({ id, name: id, status: 'active' as const }))
  }
  runtime.memory.listTiers = async () => [{
    id: SESSION_TIER,
    label: 'Session transcripts',
    metadata: { sourceKind: 'session_jsonl' },
  }]
  runtime.memory.listEntries = async (_tierId, opts) => sessions
    .filter((session) => session.agentId === opts?.agentId)
    .map(sessionToEntry)
  runtime.memory.getEntry = async (_tierId, id, opts) => {
    const session = sessions.find((entry) => entry.agentId === opts?.agentId && entry.id === id)
    return session ? sessionToEntry(session) : null
  }
  return runtime
}

function sessionToEntry(session: FixtureSession): RuntimeMemoryEntry {
  return {
    id: session.id,
    tierId: SESSION_TIER,
    agentId: session.agentId,
    path: session.path ?? session.id,
    content: session.content,
    updatedAt: session.updatedAt,
    metadata: { sourceKind: 'session_jsonl' },
  }
}

function writeSession(agentId: string, id: string, lines: object[], opts: { updatedAt?: string; path?: string } = {}) {
  sessions.push({
    agentId,
    id,
    content: lines.map(l => JSON.stringify(l)).join('\n') + '\n',
    updatedAt: opts.updatedAt,
    path: opts.path,
  })
}

beforeEach(() => {
  sessions = []
})

describe('parseSessionUsageContent', () => {
  it('marks cost unavailable when runtime usage omits cost data', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-unknown-cost', timestamp: '2026-03-26T10:00:00Z' }),
      JSON.stringify({
        type: 'message',
        id: 'msg-1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-6',
          usage: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 0, totalTokens: 1700 },
        },
      }),
    ].join('\n') + '\n'

    const result = parseSessionUsageContent(content, 'patch')

    expect(result).not.toBeNull()
    expect(result?.tokens).toEqual({ input: 1000, output: 500, cacheRead: 200, cacheWrite: 0, total: 1700 })
    expect(result?.cost.source).toBe('unavailable')
    expect(result?.cost.total).toBeNull()
  })

  it('keeps runtime-reported zero cost distinct from unavailable cost', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-zero-cost', timestamp: '2026-03-26T10:00:00Z' }),
      JSON.stringify({
        type: 'message',
        id: 'msg-1',
        message: {
          role: 'assistant',
          model: 'local-model',
          usage: {
            input: 100,
            output: 50,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 150,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      }),
    ].join('\n') + '\n'

    const result = parseSessionUsageContent(content, 'local')

    expect(result).not.toBeNull()
    expect(result?.cost.source).toBe('runtime')
    expect(result?.cost.total).toBe(0)
  })

  it('honors an explicit zero total instead of replacing it with component costs', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-explicit-zero', timestamp: '2026-03-26T10:00:00Z' }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'local-model',
          usage: {
            input: 100,
            output: 50,
            totalTokens: 150,
            cost: { input: 0.25, output: 0.5, total: 0 },
          },
        },
      }),
    ].join('\n') + '\n'

    expect(parseSessionUsageContent(content, 'local')?.cost.total).toBe(0)
  })

  it('derives total tokens from components when the runtime omits the additive total', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-derived-tokens', timestamp: '2026-03-26T10:00:00Z' }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-6',
          usage: { input: 100, output: 50, cacheRead: 25, cacheWrite: 10 },
        },
      }),
    ].join('\n') + '\n'

    expect(parseSessionUsageContent(content, 'patch')?.tokens).toEqual({
      input: 100,
      output: 50,
      cacheRead: 25,
      cacheWrite: 10,
      total: 185,
    })
  })

  it('derives total cost from runtime component costs when total is omitted', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-component-cost', timestamp: '2026-03-26T10:00:00Z' }),
      JSON.stringify({
        type: 'message',
        id: 'msg-1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-6',
          usage: {
            input: 1000,
            output: 500,
            cacheRead: 200,
            cacheWrite: 300,
            totalTokens: 2000,
            cost: { input: 0.01, output: 0.005, cacheRead: 0.001, cacheWrite: 0.002 },
          },
        },
      }),
    ].join('\n') + '\n'

    const result = parseSessionUsageContent(content, 'patch')

    expect(result).not.toBeNull()
    expect(result?.cost.source).toBe('runtime')
    expect(result?.cost.total).toBeCloseTo(0.018)
  })

  it('sums explicit totals with component-derived totals across messages', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-mixed-cost', timestamp: '2026-03-26T10:00:00Z' }),
      JSON.stringify({
        type: 'message',
        id: 'msg-explicit',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-6',
          usage: {
            input: 100,
            output: 50,
            totalTokens: 150,
            cost: { input: 0.01, output: 0.02, total: 0.03 },
          },
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-components',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-6',
          usage: {
            input: 200,
            output: 100,
            totalTokens: 300,
            cost: { input: 0.04, output: 0.05 },
          },
        },
      }),
    ].join('\n') + '\n'

    const result = parseSessionUsageContent(content, 'patch')

    expect(result).not.toBeNull()
    expect(result?.cost.total).toBeCloseTo(0.12)
  })

  it('withholds an aggregate whose individually finite costs overflow', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-cost-overflow', timestamp: '2026-03-26T10:00:00Z' }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'runtime-model',
          usage: { input: 1, output: 0, totalTokens: 1, cost: { total: Number.MAX_VALUE } },
        },
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'runtime-model',
          usage: { input: 1, output: 0, totalTokens: 1, cost: { total: Number.MAX_VALUE } },
        },
      }),
    ].join('\n')

    expect(parseSessionUsageContent(content, 'overflow')).toBeNull()
  })

  it('normalizes parseable session timestamps to the wire datetime shape', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-normalized-time', timestamp: 'July 15, 2026 12:00:00 UTC' }),
      JSON.stringify({
        type: 'message',
        timestamp: 'July 15, 2026 12:01:00 UTC',
        message: {
          role: 'assistant',
          model: 'runtime-model',
          usage: { input: 1, output: 0, totalTokens: 1 },
        },
      }),
    ].join('\n')

    const result = parseSessionUsageContent(content, 'normalized')

    expect(result?.sessionStarted).toBe('2026-07-15T12:00:00.000Z')
    expect(result?.lastMessageAt).toBe('2026-07-15T12:01:00.000Z')
  })
})

describe('getAllAgentUsage', () => {
  it('returns empty array when no agents exist', async () => {
    const result = await getAllAgentUsage(makeRuntime())
    expect(result).toEqual([])
  })

  it('parses a single agent session with usage data', async () => {
    writeSession('pixel', 'session-1.jsonl', [
      { type: 'session', id: 'sess-1', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-1', timestamp: '2026-03-26T10:01:00Z',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: {
            input: 1000, output: 500, cacheRead: 200, cacheWrite: 300, totalTokens: 2000,
            cost: { input: 0.01, output: 0.005, cacheRead: 0.001, cacheWrite: 0.002, total: 0.018 },
          },
        },
      },
    ])

    const result = await getAllAgentUsage(makeRuntime())
    expect(result).toHaveLength(1)
    expect(result[0].agent).toBe('pixel')
    expect(result[0].sessionId).toBe('sess-1')
    expect(result[0].model).toBe('claude-opus-4-6')
    expect(result[0].messages).toBe(1)
    expect(result[0].tokens.total).toBe(2000)
    expect(result[0].cost.total).toBeCloseTo(0.018)
  })

  it('sums usage across multiple messages', async () => {
    const msg = (input: number, output: number) => ({
      type: 'message', id: `msg-${input}`,
      message: {
        role: 'assistant', model: 'claude-opus-4-6',
        usage: {
          input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
          cost: { input: input * 0.00001, output: output * 0.00001, cacheRead: 0, cacheWrite: 0, total: (input + output) * 0.00001 },
        },
      },
    })

    writeSession('trainer', 'session-1.jsonl', [
      { type: 'session', id: 'sess-1', timestamp: '2026-03-26T10:00:00Z' },
      msg(1000, 200),
      msg(2000, 400),
      msg(3000, 600),
    ])

    const result = await getAllAgentUsage(makeRuntime())
    expect(result).toHaveLength(1)
    expect(result[0].messages).toBe(3)
    expect(result[0].tokens.input).toBe(6000)
    expect(result[0].tokens.output).toBe(1200)
    expect(result[0].tokens.total).toBe(7200)
  })

  it('uses the most recent session entry by first JSONL timestamp', async () => {
    writeSession('explorer', 'aaa-old.jsonl', [
      { type: 'session', id: 'old', timestamp: '2026-03-20T10:00:00Z' },
      {
        type: 'message', id: 'msg-old',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } },
        },
      },
    ])

    writeSession('explorer', 'zzz-new.jsonl', [
      { type: 'session', id: 'new', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-new',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0, totalTokens: 7000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.05 } },
        },
      },
    ])

    const result = await getAllAgentUsage(makeRuntime())
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe('new')
    expect(result[0].tokens.total).toBe(7000)
  })

  it('skips deleted session entries', async () => {
    writeSession('chef', 'abc.jsonl.deleted.2026-03-20', [
      { type: 'session', id: 'del' },
    ])

    const result = await getAllAgentUsage(makeRuntime())
    expect(result).toEqual([])
  })

  it('skips user messages and only counts assistant usage', async () => {
    writeSession('patch', 'session-1.jsonl', [
      { type: 'session', id: 'sess-1', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-user',
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'message', id: 'msg-asst',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 600, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.005 } },
        },
      },
    ])

    const result = await getAllAgentUsage(makeRuntime())
    expect(result).toHaveLength(1)
    expect(result[0].messages).toBe(1)
  })

  it('returns multiple agents sorted by total tokens descending', async () => {
    writeSession('small', 'session-1.jsonl', [
      { type: 'session', id: 's1', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-1',
        message: {
          role: 'assistant', model: 'claude-haiku-4-5',
          usage: { input: 100, output: 50, totalTokens: 150, cost: { total: 0.001 } },
        },
      },
    ])

    writeSession('big', 'session-1.jsonl', [
      { type: 'session', id: 's2', timestamp: '2026-03-26T10:00:00Z' },
      {
        type: 'message', id: 'msg-1',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 50000, output: 10000, totalTokens: 60000, cost: { total: 0.50 } },
        },
      },
    ])

    const result = await getAllAgentUsage(makeRuntime())
    expect(result).toHaveLength(2)
    expect(result[0].agent).toBe('big')
    expect(result[1].agent).toBe('small')
  })

  it('withholds a partially parsed session instead of publishing an incomplete total', async () => {
    sessions.push({
      agentId: 'broken',
      id: 'session-1.jsonl',
      content: [
        JSON.stringify({ type: 'session', id: 'sess-1', timestamp: '2026-03-26T10:00:00Z' }),
        'this is not json',
        JSON.stringify({
          type: 'message', id: 'msg-1',
          message: {
            role: 'assistant', model: 'claude-opus-4-6',
            usage: { input: 100, output: 50, totalTokens: 150, cost: { total: 0.001 } },
          },
        }),
      ].join('\n') + '\n',
    })

    const snapshot = await getAgentUsageSnapshot(makeRuntime())
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.source).toEqual({
      status: 'partial',
      reason: 'session_read_failures',
      failedAgents: ['broken'],
    })
  })
})

describe('getAgentUsageSnapshot', () => {
  it('reports an unavailable transcript source instead of an empty complete fleet', async () => {
    const runtime = makeRuntime()
    runtime.memory.listTiers = async () => { throw new Error('runtime offline') }

    const snapshot = await getAgentUsageSnapshot(runtime)

    expect(snapshot.sessions).toEqual([])
    expect(snapshot.source).toEqual({
      status: 'unavailable',
      reason: 'transcript_source_unavailable',
      failedAgents: [],
    })
  })

  it('reports an unavailable agent roster instead of no activity', async () => {
    const runtime = makeRuntime()
    runtime.agents.list = async () => { throw new Error('roster offline') }

    const snapshot = await getAgentUsageSnapshot(runtime)

    expect(snapshot.sessions).toEqual([])
    expect(snapshot.source).toEqual({
      status: 'unavailable',
      reason: 'agent_roster_unavailable',
      failedAgents: [],
    })
  })

  it('keeps successful agents while naming agents whose session evidence failed', async () => {
    writeSession('alpha', 'alpha.jsonl', [
      { type: 'session', id: 'alpha-session', timestamp: '2026-07-15T10:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T10:01:00Z', message: { role: 'assistant', model: 'm1', usage: { input: 10, output: 2 } } },
    ], { updatedAt: '2026-07-15T10:01:00Z' })
    writeSession('beta', 'beta.jsonl', [
      { type: 'session', id: 'beta-session', timestamp: '2026-07-15T10:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T10:02:00Z', message: { role: 'assistant', model: 'm1', usage: { input: 20, output: 4 } } },
    ], { updatedAt: '2026-07-15T10:02:00Z' })
    const runtime = makeRuntime()
    const read = runtime.memory.getEntry.bind(runtime.memory)
    runtime.memory.getEntry = async (tierId, id, opts) => {
      if (opts?.agentId === 'beta') throw new Error('cannot read beta')
      return await read(tierId, id, opts)
    }

    const snapshot = await getAgentUsageSnapshot(runtime)

    expect(snapshot.sessions.map((row) => row.agent)).toEqual(['alpha'])
    expect(snapshot.source).toEqual({
      status: 'partial',
      reason: 'session_read_failures',
      failedAgents: ['beta'],
    })
  })

  it('withholds schema-invalid and overflowing usage from the latest-session snapshot', async () => {
    writeSession('alpha', 'alpha.jsonl', [
      { type: 'session', id: 'alpha-session', timestamp: '2026-07-15T10:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T10:01:00Z', message: { role: 'assistant', model: 'm1', usage: { input: 10.5, output: 2 } } },
    ], { updatedAt: '2026-07-15T10:01:00Z' })
    writeSession('beta', 'beta.jsonl', [
      { type: 'session', id: 'beta-session', timestamp: '2026-07-15T10:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T10:01:00Z', message: { role: 'assistant', model: 'm1', usage: { input: Number.MAX_SAFE_INTEGER, output: 0 } } },
      { type: 'message', timestamp: '2026-07-15T10:02:00Z', message: { role: 'assistant', model: 'm1', usage: { input: 1, output: 0 } } },
    ], { updatedAt: '2026-07-15T10:02:00Z' })
    writeSession('gamma', 'gamma.jsonl', [
      { type: 'session', id: 'gamma-session', timestamp: '2026-07-15T10:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T10:03:00Z', message: { role: 'assistant', model: 'm1', usage: {} } },
    ], { updatedAt: '2026-07-15T10:03:00Z' })

    const snapshot = await getAgentUsageSnapshot(makeRuntime())

    expect(snapshot.sessions).toEqual([])
    expect(snapshot.source).toEqual({
      status: 'partial',
      reason: 'session_read_failures',
      failedAgents: ['alpha', 'beta', 'gamma'],
    })
  })

  it('withholds a session when the compatibility scan cannot read every candidate', async () => {
    writeSession('alpha', 'readable.jsonl', [
      { type: 'session', id: 'readable-session', timestamp: '2026-07-15T10:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T10:01:00Z', message: { role: 'assistant', model: 'm1', usage: { input: 10, output: 2 } } },
    ], { updatedAt: '2026-07-15T10:01:00Z' })
    writeSession('alpha', 'unreadable.jsonl', [
      { type: 'session', id: 'unreadable-session', timestamp: '2026-07-15T11:00:00Z' },
    ])
    const runtime = makeRuntime()
    const read = runtime.memory.getEntry.bind(runtime.memory)
    runtime.memory.getEntry = async (tierId, id, opts) => {
      if (id === 'unreadable.jsonl') throw new Error('cannot read candidate')
      return await read(tierId, id, opts)
    }

    const snapshot = await getAgentUsageSnapshot(runtime)

    expect(snapshot.source).toEqual({
      status: 'partial',
      reason: 'session_read_failures',
      failedAgents: ['alpha'],
    })
    expect(snapshot.sessions).toEqual([])
  })

  it('selects from listing metadata and reads only the newest full transcript', async () => {
    writeSession('alpha', 'old.jsonl', [
      { type: 'session', id: 'old-session', timestamp: '2026-07-15T12:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T12:01:00Z', message: { role: 'assistant', model: 'old', usage: { input: 100, output: 0 } } },
    ], { updatedAt: '2026-07-15T12:01:00Z' })
    writeSession('alpha', 'active.jsonl', [
      { type: 'session', id: 'active-session', timestamp: '2026-07-14T12:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T13:01:00Z', message: { role: 'assistant', model: 'active', usage: { input: 200, output: 0 } } },
    ], { updatedAt: '2026-07-15T13:01:00Z' })
    const runtime = makeRuntime()
    const read = runtime.memory.getEntry.bind(runtime.memory)
    const getEntry = mock(async (...args: Parameters<typeof runtime.memory.getEntry>) => await read(...args))
    runtime.memory.getEntry = getEntry

    const snapshot = await getAgentUsageSnapshot(runtime)

    expect(getEntry).toHaveBeenCalledTimes(1)
    expect(snapshot.sessions[0]).toMatchObject({
      sessionId: 'active-session',
      model: 'active',
      lastMessageAt: '2026-07-15T13:01:00.000Z',
    })
    expect(snapshot.source.status).toBe('complete')
  })

  it('withholds a metadata-selected session that changes while its transcript is read', async () => {
    writeSession('alpha', 'active.jsonl', [
      { type: 'session', id: 'active-session', timestamp: '2026-07-15T12:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T12:01:00Z', message: { role: 'assistant', model: 'active', usage: { input: 100, output: 0 } } },
    ], { updatedAt: '2026-07-15T12:01:00Z' })
    const runtime = makeRuntime()
    const contentSize = Buffer.byteLength(sessions[0].content, 'utf-8')
    let statCalls = 0
    runtime.memory.statEntry = async () => {
      statCalls++
      return statCalls === 1
        ? { mtimeMs: 1_000, size: contentSize }
        : { mtimeMs: 2_000, size: contentSize + 64 }
    }

    const snapshot = await getAgentUsageSnapshot(runtime)

    expect(statCalls).toBe(2)
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.source).toEqual({
      status: 'partial',
      reason: 'session_read_failures',
      failedAgents: ['alpha'],
    })
  })

  it('withholds a metadata-selected prefix that does not match a stable file generation', async () => {
    writeSession('alpha', 'active.jsonl', [
      { type: 'session', id: 'active-session', timestamp: '2026-07-15T12:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T12:01:00Z', message: { role: 'assistant', model: 'active', usage: { input: 100, output: 0 } } },
    ], { updatedAt: '2026-07-15T12:01:00Z' })
    const runtime = makeRuntime()
    const reportedSize = Buffer.byteLength(sessions[0].content, 'utf-8') + 64
    runtime.memory.statEntry = async () => ({ mtimeMs: 1_000, size: reportedSize })

    const snapshot = await getAgentUsageSnapshot(runtime)

    expect(snapshot.sessions).toEqual([])
    expect(snapshot.source).toEqual({
      status: 'partial',
      reason: 'session_read_failures',
      failedAgents: ['alpha'],
    })
  })

  it('withholds a session when stat evidence appears during its read', async () => {
    writeSession('alpha', 'active.jsonl', [
      { type: 'session', id: 'active-session', timestamp: '2026-07-15T12:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T12:01:00Z', message: { role: 'assistant', model: 'active', usage: { input: 100, output: 0 } } },
    ], { updatedAt: '2026-07-15T12:01:00Z' })
    const runtime = makeRuntime()
    const contentSize = Buffer.byteLength(sessions[0].content, 'utf-8')
    let statCalls = 0
    runtime.memory.statEntry = async () => {
      statCalls++
      return statCalls === 1 ? null : { mtimeMs: 1_000, size: contentSize }
    }

    const snapshot = await getAgentUsageSnapshot(runtime)

    expect(snapshot.sessions).toEqual([])
    expect(snapshot.source).toEqual({
      status: 'partial',
      reason: 'session_read_failures',
      failedAgents: ['alpha'],
    })
  })

  it('withholds compatibility-scan evidence when any candidate changes during its read', async () => {
    writeSession('alpha', 'older.jsonl', [
      { type: 'session', id: 'older-session', timestamp: '2026-07-15T10:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T10:01:00Z', message: { role: 'assistant', model: 'older', usage: { input: 10, output: 0 } } },
    ])
    writeSession('alpha', 'active.jsonl', [
      { type: 'session', id: 'active-session', timestamp: '2026-07-15T12:00:00Z' },
      { type: 'message', timestamp: '2026-07-15T12:01:00Z', message: { role: 'assistant', model: 'active', usage: { input: 100, output: 0 } } },
    ])
    const runtime = makeRuntime()
    const statCalls = new Map<string, number>()
    runtime.memory.statEntry = async (_tierId, id) => {
      const call = (statCalls.get(id) ?? 0) + 1
      statCalls.set(id, call)
      const session = sessions.find((entry) => entry.id === id)!
      const size = Buffer.byteLength(session.content, 'utf-8')
      if (id === 'active.jsonl' && call === 2) return { mtimeMs: 2_000, size: size + 64 }
      return { mtimeMs: 1_000, size }
    }

    const snapshot = await getAgentUsageSnapshot(runtime)

    expect(statCalls).toEqual(new Map([
      ['older.jsonl', 2],
      ['active.jsonl', 2],
    ]))
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.source).toEqual({
      status: 'partial',
      reason: 'session_read_failures',
      failedAgents: ['alpha'],
    })
  })
})

describe('parseSessionUsageMessages', () => {
  it('surfaces per-message timestamp, model, tokens, and cost', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'sess-1', timestamp: '2026-07-01T10:00:00Z' }),
      JSON.stringify({
        type: 'message', timestamp: '2026-07-01T10:01:00Z',
        message: { role: 'assistant', model: 'gpt-5.4', usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, cost: { total: 0.01 } } },
      }),
      JSON.stringify({
        type: 'message', timestamp: '2026-07-02T09:00:00Z',
        message: { role: 'assistant', model: 'claude-fable-5', usage: { input: 20, output: 10, totalTokens: 30 } },
      }),
    ].join('\n')

    const parsed = parseSessionUsageMessages(content)
    expect(parsed.sessionId).toBe('sess-1')
    expect(parsed.sessionStarted).toBe('2026-07-01T10:00:00.000Z')
    expect(parsed.messages).toHaveLength(2)

    expect(parsed.messages[0].tsMs).toBe(Date.parse('2026-07-01T10:01:00Z'))
    expect(parsed.messages[0].model).toBe('gpt-5.4')
    expect(parsed.messages[0].tokens).toEqual({ input: 10, output: 5, cacheRead: 2, cacheWrite: 1, total: 18 })
    expect(parsed.messages[0].cost).toEqual({ total: 0.01 })

    expect(parsed.messages[1].model).toBe('claude-fable-5')
    expect(parsed.messages[1].cost).toBeNull()
  })

  it('missing timestamp/model become null/empty, never fabricated', () => {
    const content = JSON.stringify({
      type: 'message',
      message: { role: 'assistant', usage: { input: 1, output: 1, totalTokens: 2 } },
    })
    const parsed = parseSessionUsageMessages(content)
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].tsMs).toBeNull()
    expect(parsed.messages[0].model).toBe('')
  })

  it('surfaces malformed lines while retaining valid messages for inspection', () => {
    const content = [
      'not json {{{',
      JSON.stringify({ type: 'message', message: { role: 'user' } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant' } }),
      JSON.stringify({ type: 'message', timestamp: '2026-07-01T10:00:00Z', message: { role: 'assistant', usage: { input: 3, output: 4, totalTokens: 7 } } }),
    ].join('\n')
    const parsed = parseSessionUsageMessages(content)
    expect(parsed.integrity).toEqual({ status: 'partial', malformedLines: 1 })
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].tokens.total).toBe(7)
  })

  it('reports complete integrity when every non-empty line is valid JSON', () => {
    const parsed = parseSessionUsageMessages([
      JSON.stringify({ type: 'session', id: 's' }),
      JSON.stringify({ type: 'message', message: { role: 'user' } }),
    ].join('\n'))

    expect(parsed.integrity).toEqual({ status: 'complete', malformedLines: 0 })
  })

  it('marks structurally invalid known message rows partial', () => {
    const parsed = parseSessionUsageMessages([
      JSON.stringify({ type: 'message' }),
      JSON.stringify({ type: 'message', message: null }),
      JSON.stringify({ type: 'message', message: {} }),
      JSON.stringify({ type: 'message', message: { role: 42 } }),
      JSON.stringify({ type: 'message', timestamp: 42, message: { role: 'user' } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', model: 42 } }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'valid and intentionally ignored' } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', model: 'm1' } }),
    ].join('\n'))

    expect(parsed.integrity).toEqual({ status: 'partial', malformedLines: 6 })
    expect(parsed.messages).toEqual([])
  })

  it('treats valid JSON scalars and arrays as malformed transcript rows', () => {
    const parsed = parseSessionUsageMessages([
      'null',
      '42',
      '[]',
      JSON.stringify({ type: 'session', id: 's' }),
    ].join('\n'))

    expect(parsed.integrity).toEqual({ status: 'partial', malformedLines: 3 })
  })

  it('requires a string transcript type while keeping unknown string types forward-compatible', () => {
    const malformed = parseSessionUsageMessages([
      JSON.stringify({}),
      JSON.stringify({ type: 42 }),
    ].join('\n'))
    const forwardCompatible = parseSessionUsageMessages(JSON.stringify({
      type: 'future_runtime_metadata',
      payload: { version: 1 },
    }))

    expect(malformed.integrity).toEqual({ status: 'partial', malformedLines: 2 })
    expect(forwardCompatible.integrity).toEqual({ status: 'complete', malformedLines: 0 })
  })

  it('marks invalid known timestamps partial instead of publishing incompatible evidence', () => {
    const parsed = parseSessionUsageMessages([
      JSON.stringify({ type: 'session', id: 's', timestamp: 'not-a-date' }),
      JSON.stringify({
        type: 'message',
        timestamp: 'also-not-a-date',
        message: { role: 'assistant', usage: { input: 1, output: 0, totalTokens: 1 } },
      }),
    ].join('\n'))

    expect(parsed.integrity).toEqual({ status: 'partial', malformedLines: 2 })
    expect(parsed.messages).toEqual([])
  })

  it('rejects parseable message timestamps outside the four-digit wire year range', () => {
    const parsed = parseSessionUsageMessages(JSON.stringify({
      type: 'message',
      timestamp: '+275760-09-13T00:00:00.000Z',
      message: { role: 'assistant', usage: { input: 1, output: 0, totalTokens: 1 } },
    }))

    expect(parsed.integrity).toEqual({ status: 'partial', malformedLines: 1 })
    expect(parsed.messages).toEqual([])
  })

  it('rejects invalid assistant token and cost fields instead of coercing them into totals', () => {
    const tokenFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const
    const costFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const
    const invalidTokenLines = tokenFields.map((field, index) => JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        usage: { input: 1, output: 1, [field]: index === 0 ? '3' : -1 },
      },
    }))
    const invalidCostLines = costFields.map((field) => JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        usage: { input: 1, output: 1, cost: { [field]: -1 } },
      },
    }))
    const invalidUsageShape = JSON.stringify({
      type: 'message',
      message: { role: 'assistant', usage: [] },
    })
    const fractionalTokenLines = tokenFields.map((field) => JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        usage: { input: 1, output: 1, [field]: 1.5 },
      },
    }))
    const unsafeTokenLines = tokenFields.map((field) => JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        usage: { input: 1, output: 1, [field]: Number.MAX_SAFE_INTEGER + 1 },
      },
    }))
    const validLine = JSON.stringify({
      type: 'message',
      message: { role: 'assistant', usage: { input: 2, output: 1, totalTokens: 3 } },
    })

    const parsed = parseSessionUsageMessages([
      ...invalidTokenLines,
      ...invalidCostLines,
      invalidUsageShape,
      ...fractionalTokenLines,
      ...unsafeTokenLines,
      validLine,
    ].join('\n'))

    expect(parsed.integrity).toEqual({ status: 'partial', malformedLines: 21 })
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].tokens.total).toBe(3)
  })

  it('marks incomplete or contradictory token totals partial', () => {
    const parsed = parseSessionUsageMessages([
      JSON.stringify({
        type: 'message',
        message: { role: 'assistant', usage: { input: 10 } },
      }),
      JSON.stringify({
        type: 'message',
        message: { role: 'assistant', usage: { input: 10, output: 5, totalTokens: 0 } },
      }),
      JSON.stringify({
        type: 'message',
        message: { role: 'assistant', usage: {} },
      }),
    ].join('\n'))

    expect(parsed.integrity).toEqual({ status: 'partial', malformedLines: 3 })
    expect(parsed.messages).toEqual([])
  })

  it('rejects total-only transcript usage instead of fabricating zero components', () => {
    const content = JSON.stringify({
      type: 'message',
      message: { role: 'assistant', usage: { totalTokens: 15 } },
    })

    const parsed = parseSessionUsageMessages(content)

    expect(parsed.integrity).toEqual({ status: 'partial', malformedLines: 1 })
    expect(parsed.messages).toEqual([])
    expect(parseSessionUsageContent(content, 'main')).toBeNull()
  })

  it('agrees with parseSessionUsageContent sums (single-parser invariant)', () => {
    const lines = [
      JSON.stringify({ type: 'session', id: 's', timestamp: '2026-07-01T00:00:00Z' }),
      JSON.stringify({ type: 'message', timestamp: '2026-07-01T01:00:00Z', message: { role: 'assistant', model: 'm1', usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165, cost: { input: 0.001, output: 0.002 } } } }),
      JSON.stringify({ type: 'message', timestamp: '2026-07-01T02:00:00Z', message: { role: 'assistant', model: 'm2', usage: { input: 200, output: 100, totalTokens: 300 } } }),
    ]
    const content = lines.join('\n')

    const messages = parseSessionUsageMessages(content).messages
    const summed = messages.reduce((acc, m) => acc + m.tokens.total, 0)
    const card = parseSessionUsageContent(content, 'agent-x')
    expect(card?.tokens.total).toBe(summed)
    expect(card?.model).toBe('m2')
  })
})
