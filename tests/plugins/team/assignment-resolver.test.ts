/**
 * Team → agent assignment resolver (#189, runtime transport).
 *
 * The resolver assembles the candidate pool (team members ∩ runtime roster —
 * existence is the only hard filter), builds byte-budgeted member profiles,
 * and asks the routing LLM via an EPHEMERAL RUNTIME TURN as the main agent
 * (never a direct provider call — no API keys involved). All collaborators
 * are injected; the runtime is a scripted fake — tests never make live calls.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = join(tmpdir(), `bakin-assignment-resolver-test-${Date.now()}`)
process.env.BAKIN_HOME = testHome

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), tasks: join(testHome, 'tasks') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), tasks: join(testHome, 'tasks') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testHome, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testHome, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
}))

import {
  resolveTeamAssignment,
  MEMBER_PROFILE_BYTE_BUDGET,
  type ResolverDeps,
} from '../../../plugins/team/lib/assignment-resolver'
import { RuntimeError } from '@bakin/core/adapters/runtime'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const ROSTER = [
  { id: 'dev', name: 'Dev', role: 'developer', model: 'claude-sonnet-4-6' },
  { id: 'reviewer', name: 'Reviewer', role: 'code reviewer', model: 'claude-sonnet-4-6' },
  { id: 'architect', name: 'Architect', role: 'architect', model: 'claude-opus-4-6' },
]

type SendCall = {
  agentId: string
  content: string
  threadId?: string
  ephemeral?: boolean
  model?: string
  thinking?: string
  activityClass?: string
}

/** Scripted runtime: each send pops the next reply (a content string or an
 * Error to throw) and records the full send args. */
function fakeRuntime(replies: Array<string | Error>, overrides: { soul?: Record<string, string> } = {}) {
  const sends: SendCall[] = []
  let i = 0
  const runtime = {
    agents: {
      list: async () => ROSTER.map((a) => ({ ...a })),
      get: async (id: string) => ROSTER.find((a) => a.id === id) ?? null,
      readWorkspaceFile: async (agentId: string, path: string) => {
        const soul = overrides.soul?.[agentId]
        if (path === 'SOUL.md' && soul) return { content: soul }
        if (path === 'IDENTITY.md') return { content: `# ${agentId} identity` }
        return null
      },
    },
    messaging: {
      send: async (args: SendCall) => {
        sends.push(args)
        const reply = replies[Math.min(i++, replies.length - 1)]
        if (reply instanceof Error) throw reply
        return { content: reply, usage: { model: args.model ?? 'agent-default' } }
      },
    },
  } as unknown as AgentRuntimeAdapter
  return { runtime, sends }
}

type MeterCall = Parameters<NonNullable<ResolverDeps['meter']>>[0]

function fakeMeter() {
  const calls: MeterCall[] = []
  const impl: NonNullable<ResolverDeps['meter']> = async (opts) => { calls.push(opts) }
  return { impl, calls }
}

const PICK = JSON.stringify({ agentId: 'reviewer', reason: 'review task' })

function deps(runtime: AgentRuntimeAdapter, overrides: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    runtime,
    route: {},
    meter: fakeMeter().impl,
    getMainAgentId: async () => 'main',
    readTeams: () => [{ id: 'development', label: 'Development', reportsTo: null }],
    getTeamMembers: async () => ['dev', 'reviewer', 'architect'],
    getStatus: () => 'online',
    ...overrides,
  }
}

const REQUEST = {
  teamId: 'development',
  task: { id: 'task-1', title: 'Review the auth PR', description: 'Go through the diff', tags: ['review'] },
}

// ---------------------------------------------------------------------------

describe('happy path', () => {
  it('returns the picked in-pool agent; no route = inherit', async () => {
    const { runtime } = fakeRuntime([PICK])
    const result = await resolveTeamAssignment(deps(runtime), REQUEST)
    expect(result).toEqual({ ok: true, agentId: 'reviewer', reason: 'review task', model: 'inherit' })
  })

  it('sends ONE ephemeral system turn as the main agent on the task route thread', async () => {
    const { runtime, sends } = fakeRuntime([PICK])
    await resolveTeamAssignment(deps(runtime), REQUEST)
    expect(sends).toHaveLength(1)
    expect(sends[0].agentId).toBe('main')
    expect(sends[0].ephemeral).toBe(true)
    expect(sends[0].activityClass).toBe('system')
    expect(sends[0].threadId).toBe('task:task-1:route')
    expect(sends[0].model).toBeUndefined()
  })

  it('passes the team-routing route as a per-turn model/thinking override', async () => {
    const { runtime, sends } = fakeRuntime([PICK])
    const result = await resolveTeamAssignment(
      deps(runtime, { route: { model: 'openai-codex/gpt-5.4-mini', thinking: 'low', source: 'class' } }),
      REQUEST,
    )
    expect(sends[0].model).toBe('openai-codex/gpt-5.4-mini')
    expect(sends[0].thinking).toBe('low')
    expect(result.ok && result.model).toBe('openai-codex/gpt-5.4-mini')
  })

  it('meters every send under the team-routing work class on the route thread', async () => {
    const meter = fakeMeter()
    const { runtime } = fakeRuntime(['not json', PICK])
    await resolveTeamAssignment(deps(runtime, {
      meter: meter.impl,
      route: { model: 'openai-codex/gpt-5.4-mini', source: 'class' },
    }), REQUEST)
    expect(meter.calls).toHaveLength(2)
    for (const call of meter.calls) {
      expect(call.workClass).toBe('team-routing')
      expect(call.agent).toBe('main')
      expect(call.runId).toBe('task:task-1:route')
      expect(call.routeSource).toBe('class')
      expect(call.resolvedModel).toBe('openai-codex/gpt-5.4-mini')
    }
  })

  it('accepts a reply wrapped in a json fence', async () => {
    const { runtime } = fakeRuntime(['```json\n' + PICK + '\n```'])
    const result = await resolveTeamAssignment(deps(runtime), REQUEST)
    expect(result.ok && result.agentId).toBe('reviewer')
  })

  it('prompt carries task fields and every pool member with role/status', async () => {
    const { runtime, sends } = fakeRuntime([PICK])
    await resolveTeamAssignment(deps(runtime), REQUEST)
    const prompt = sends[0].content
    expect(prompt).toContain('Review the auth PR')
    expect(prompt).toContain('Go through the diff')
    for (const member of ['dev', 'reviewer', 'architect']) expect(prompt).toContain(member)
    expect(prompt).toContain('code reviewer')
    expect(prompt).toContain('online')
  })

  it('truncates oversized SOUL prose to the member byte budget with a visible marker', async () => {
    const huge = 'x'.repeat(MEMBER_PROFILE_BYTE_BUDGET * 4)
    const { runtime, sends } = fakeRuntime([PICK], { soul: { dev: huge } })
    await resolveTeamAssignment(deps(runtime), REQUEST)
    const prompt = sends[0].content
    expect(prompt).toContain('[truncated]')
    expect(prompt.length).toBeLessThan(MEMBER_PROFILE_BYTE_BUDGET * 6)
  })
})

describe('pool assembly', () => {
  it('members missing from the runtime roster are dropped from the pool', async () => {
    const { runtime, sends } = fakeRuntime([JSON.stringify({ agentId: 'dev', reason: 'r' })])
    await resolveTeamAssignment(deps(runtime, { getTeamMembers: async () => ['dev', 'ghost-agent'] }), REQUEST)
    expect(sends[0].content).not.toContain('ghost-agent')
  })

  it('unknown team → structural', async () => {
    const { runtime } = fakeRuntime([PICK])
    const result = await resolveTeamAssignment(deps(runtime, { readTeams: () => [] }), REQUEST)
    expect(result).toEqual({ ok: false, kind: 'structural', message: expect.stringContaining('development') })
  })

  it('zero eligible members → structural, no send fired', async () => {
    const { runtime, sends } = fakeRuntime([PICK])
    const result = await resolveTeamAssignment(deps(runtime, { getTeamMembers: async () => [] }), REQUEST)
    expect(!result.ok && result.kind).toBe('structural')
    expect(sends).toHaveLength(0)
  })
})

describe('reply handling', () => {
  it('malformed reply gets ONE corrective re-ask on the same thread, then succeeds', async () => {
    const { runtime, sends } = fakeRuntime(['sorry, plain prose', PICK])
    const result = await resolveTeamAssignment(deps(runtime), REQUEST)
    expect(sends).toHaveLength(2)
    expect(sends[1].threadId).toBe('task:task-1:route')
    expect(sends[1].content).toContain('ONLY a JSON object')
    expect(result.ok && result.agentId).toBe('reviewer')
  })

  it('malformed twice → transient', async () => {
    const { runtime, sends } = fakeRuntime(['prose', 'more prose'])
    const result = await resolveTeamAssignment(deps(runtime), REQUEST)
    expect(sends).toHaveLength(2)
    expect(!result.ok && result.kind).toBe('transient')
  })

  it('out-of-pool pick re-asks once then succeeds', async () => {
    const { runtime, sends } = fakeRuntime([
      JSON.stringify({ agentId: 'someone-else', reason: 'bad pick' }),
      JSON.stringify({ agentId: 'architect', reason: 'good pick' }),
    ])
    const result = await resolveTeamAssignment(deps(runtime), REQUEST)
    expect(sends).toHaveLength(2)
    expect(result.ok && result.agentId).toBe('architect')
  })

  it('out-of-pool twice → transient naming the bad pick', async () => {
    const { runtime } = fakeRuntime([
      JSON.stringify({ agentId: 'nope-1', reason: 'r' }),
      JSON.stringify({ agentId: 'nope-2', reason: 'r' }),
    ])
    const result = await resolveTeamAssignment(deps(runtime), REQUEST)
    expect(!result.ok && result.kind).toBe('transient')
    expect(!result.ok && result.message).toContain('nope-2')
  })
})

describe('runtime failure mapping', () => {
  it('RuntimeError not_found → structural (send target missing)', async () => {
    const { runtime } = fakeRuntime([new RuntimeError('unknown agent: main', { kind: 'not_found' })])
    const result = await resolveTeamAssignment(deps(runtime), REQUEST)
    expect(!result.ok && result.kind).toBe('structural')
  })

  it.each(['transport', 'timeout', 'provider_cooldown', 'runtime_failed', 'aborted'] as const)(
    'RuntimeError %s → transient (ladder bounds retries)',
    async (kind) => {
      const { runtime } = fakeRuntime([new RuntimeError(`boom (${kind})`, { kind })])
      const result = await resolveTeamAssignment(deps(runtime), REQUEST)
      expect(!result.ok && result.kind).toBe('transient')
    },
  )

  it('non-RuntimeError throw → transient', async () => {
    const { runtime } = fakeRuntime([new Error('weird infra failure')])
    const result = await resolveTeamAssignment(deps(runtime), REQUEST)
    expect(!result.ok && result.kind).toBe('transient')
  })
})
