/**
 * T3 (#189): team → agent assignment resolver.
 *
 * The resolver assembles the candidate pool (team members ∩ runtime roster —
 * existence is the only hard filter), builds byte-budgeted member profiles,
 * asks the routing LLM for {agentId, reason}, and returns a typed result.
 * All collaborators are injected — the transport is NEVER live in tests.
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
  DEFAULT_ROUTING_MODEL,
  DEFAULT_ROUTING_PROVIDER,
  MEMBER_PROFILE_BYTE_BUDGET,
  type ResolverDeps,
} from '../../../plugins/team/lib/assignment-resolver'
import { DirectTextError } from '../../../packages/core/src/llm/direct-text-provider'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const ROSTER = [
  { id: 'dev', name: 'Dev', role: 'developer', model: 'claude-sonnet-4-6' },
  { id: 'reviewer', name: 'Reviewer', role: 'code reviewer', model: 'claude-sonnet-4-6' },
  { id: 'architect', name: 'Architect', role: 'architect', model: 'claude-opus-4-6' },
]

function fakeRuntime(overrides: { soul?: Record<string, string> } = {}): AgentRuntimeAdapter {
  return {
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
  } as unknown as AgentRuntimeAdapter
}

type TransportCall = { prompt: string; system?: string; model: string; provider: string }

function fakeTransport(picks: Array<{ agentId: string; reason: string }>) {
  const calls: TransportCall[] = []
  let i = 0
  const impl = async (req: { prompt: string; system?: string; model: string; provider: string }) => {
    calls.push({ prompt: req.prompt, system: req.system, model: req.model, provider: req.provider })
    const pick = picks[Math.min(i++, picks.length - 1)]
    if (pick instanceof Error) throw pick
    return pick
  }
  return { impl: impl as ResolverDeps['transport'], calls }
}

function deps(overrides: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    runtime: fakeRuntime(),
    route: {},
    keySource: () => ({ apiKey: 'k', source: 'env' as const }),
    readTeams: () => [{ id: 'development', label: 'Development', reportsTo: null }],
    getTeamMembers: async () => ['dev', 'reviewer', 'architect'],
    getStatus: () => 'online',
    transport: fakeTransport([{ agentId: 'reviewer', reason: 'review task' }]).impl,
    ...overrides,
  }
}

const REQUEST = {
  teamId: 'development',
  task: { id: 'task-1', title: 'Review the auth PR', description: 'Go through the diff', tags: ['review'] },
}

// ---------------------------------------------------------------------------

describe('happy path', () => {
  it('returns the picked in-pool agent with reason and model', async () => {
    const result = await resolveTeamAssignment(deps(), REQUEST)
    expect(result).toEqual({
      ok: true,
      agentId: 'reviewer',
      reason: 'review task',
      model: `${DEFAULT_ROUTING_PROVIDER}/${DEFAULT_ROUTING_MODEL}`,
    })
  })

  it('prompt carries task fields and every pool member with role/status', async () => {
    const { impl, calls } = fakeTransport([{ agentId: 'dev', reason: 'r' }])
    await resolveTeamAssignment(deps({ transport: impl }), REQUEST)
    expect(calls).toHaveLength(1)
    const prompt = calls[0].prompt
    expect(prompt).toContain('Review the auth PR')
    expect(prompt).toContain('Go through the diff')
    for (const member of ['dev', 'reviewer', 'architect']) expect(prompt).toContain(member)
    expect(prompt).toContain('code reviewer')
    expect(prompt).toContain('online')
  })

  it('uses the team-routing matrix route for provider/model', async () => {
    const { impl, calls } = fakeTransport([{ agentId: 'dev', reason: 'r' }])
    const result = await resolveTeamAssignment(
      deps({ transport: impl, route: { model: 'google/gemini-2.5-flash', source: 'class' } }),
      REQUEST,
    )
    expect(calls[0].provider).toBe('google')
    expect(calls[0].model).toBe('gemini-2.5-flash')
    expect(result.ok && result.model).toBe('google/gemini-2.5-flash')
  })

  it('truncates oversized SOUL prose to the member byte budget with a visible marker', async () => {
    const { impl, calls } = fakeTransport([{ agentId: 'dev', reason: 'r' }])
    const huge = 'x'.repeat(MEMBER_PROFILE_BYTE_BUDGET * 4)
    await resolveTeamAssignment(
      deps({ runtime: fakeRuntime({ soul: { dev: huge } }), transport: impl }),
      REQUEST,
    )
    const prompt = calls[0].prompt
    expect(prompt).toContain('[truncated]')
    expect(prompt.length).toBeLessThan(MEMBER_PROFILE_BYTE_BUDGET * 6) // budget held, not 4x blowup per member
  })
})

describe('pool assembly', () => {
  it('members missing from the runtime roster are dropped from the pool', async () => {
    const { impl, calls } = fakeTransport([{ agentId: 'dev', reason: 'r' }])
    await resolveTeamAssignment(
      deps({ transport: impl, getTeamMembers: async () => ['dev', 'ghost-agent'] }),
      REQUEST,
    )
    expect(calls[0].prompt).not.toContain('ghost-agent')
  })

  it('matrix route on an unsupported provider → structural (never silently re-routed)', async () => {
    const result = await resolveTeamAssignment(
      deps({ route: { model: 'openai-codex/gpt-5.5', source: 'class' } }),
      REQUEST,
    )
    expect(result).toEqual({ ok: false, kind: 'structural', message: expect.stringContaining('openai-codex') })
  })

  it('unknown team → structural', async () => {
    const result = await resolveTeamAssignment(deps({ readTeams: () => [] }), REQUEST)
    expect(result).toEqual({ ok: false, kind: 'structural', message: expect.stringContaining('development') })
  })

  it('zero eligible members → structural', async () => {
    const result = await resolveTeamAssignment(deps({ getTeamMembers: async () => [] }), REQUEST)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.kind).toBe('structural')
  })

  it('no API key for the routing provider → structural', async () => {
    const result = await resolveTeamAssignment(deps({ keySource: () => null }), REQUEST)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.kind).toBe('structural')
    expect(!result.ok && result.message).toContain('anthropic')
  })
})

describe('LLM failure handling', () => {
  it('transport transient error → transient result', async () => {
    const transport = (async () => { throw new DirectTextError('transient', '429') }) as ResolverDeps['transport']
    const result = await resolveTeamAssignment(deps({ transport }), REQUEST)
    expect(!result.ok && result.kind).toBe('transient')
  })

  it('transport structural error → structural result', async () => {
    const transport = (async () => { throw new DirectTextError('structural', '401') }) as ResolverDeps['transport']
    const result = await resolveTeamAssignment(deps({ transport }), REQUEST)
    expect(!result.ok && result.kind).toBe('structural')
  })

  it('out-of-pool pick retries once then succeeds', async () => {
    const { impl, calls } = fakeTransport([
      { agentId: 'someone-else', reason: 'bad pick' },
      { agentId: 'architect', reason: 'good pick' },
    ])
    const result = await resolveTeamAssignment(deps({ transport: impl }), REQUEST)
    expect(calls).toHaveLength(2)
    expect(result.ok && result.agentId).toBe('architect')
  })

  it('out-of-pool twice → transient', async () => {
    const { impl, calls } = fakeTransport([
      { agentId: 'nope-1', reason: 'r' },
      { agentId: 'nope-2', reason: 'r' },
    ])
    const result = await resolveTeamAssignment(deps({ transport: impl }), REQUEST)
    expect(calls).toHaveLength(2)
    expect(!result.ok && result.kind).toBe('transient')
  })
})
