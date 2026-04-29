import { describe, it, expect, beforeEach } from 'bun:test'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import type { AgentRuntimeAdapter, RuntimeMemoryEntry } from '@bakin/core/adapters/runtime'
import { getAllAgentUsage } from '../../src/core/agent-usage'

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

    writeSession('nemo', 'session-1.jsonl', [
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
    writeSession('scout', 'aaa-old.jsonl', [
      { type: 'session', id: 'old', timestamp: '2026-03-20T10:00:00Z' },
      {
        type: 'message', id: 'msg-old',
        message: {
          role: 'assistant', model: 'claude-opus-4-6',
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } },
        },
      },
    ])

    writeSession('scout', 'zzz-new.jsonl', [
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
    writeSession('basil', 'abc.jsonl.deleted.2026-03-20', [
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

  it('handles malformed JSONL lines gracefully', async () => {
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

    const result = await getAllAgentUsage(makeRuntime())
    expect(result).toHaveLength(1)
    expect(result[0].messages).toBe(1)
  })
})
