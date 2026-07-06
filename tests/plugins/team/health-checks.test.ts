/**
 * Team-plugin-owned doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#139 C1) — these three checks
 * (agent-roster, personas, agent-sync) now live under the team
 * plugin and are registered via ctx.registerHealthCheck. This file
 * absorbs the prior tests/core/doctor-agent-assets.test.ts and adds
 * direct coverage for the migrated functions plus a registration
 * smoke test.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-team-health-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')

// ES imports are hoisted above mock.module — set env so any module that
// reads BAKIN_HOME / OPENCLAW_HOME at top-level resolves to the temp dir.
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir
// ANTFLY_HOME is the antfly adapter's test-isolation seam (see
// packages/adapter-antfly/src/paths.ts). agent-sync builds real AppServices,
// which now boots a private antfly instance when search is enabled — point it
// at an empty temp dir so findAntflyBinary() returns null and the adapter
// stays in file-only mode instead of spawning the real ~/.antfly binary.
process.env.ANTFLY_HOME = pathJoin(testDir, 'antfly-home')

import { describe, it, expect, beforeEach, afterAll, afterEach, mock, spyOn } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { RuntimeAgent } from '@bakin/core/adapters/runtime'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

let runtimeAgents: RuntimeAgent[] = []
let runtimeError: Error | null = null
const runtimeAgentStore = new Map<string, RuntimeAgent>()
const runtimeWorkspaceFiles = new Map<string, { path: string; content: string; metadata?: Record<string, unknown> }>()

mock.module('../../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      agents: {
        list: async () => runtimeAgents,
        get: async (agentId: string) => runtimeAgentStore.get(agentId) ?? runtimeAgents.find((agent) => agent.id === agentId) ?? null,
        create: async (input: { id?: string; name: string; role?: string; model?: string; metadata?: Record<string, unknown> }) => {
          const agent: RuntimeAgent = { id: input.id ?? input.name.toLowerCase(), name: input.name, role: input.role, model: input.model, status: 'active', metadata: input.metadata }
          runtimeAgentStore.set(agent.id, agent)
          runtimeAgents = [...runtimeAgents.filter((existing) => existing.id !== agent.id), agent]
          return agent
        },
        updateAllowlist: async () => {},
        listWorkspaceFiles: async (agentId: string) => Array.from(runtimeWorkspaceFiles.entries())
          .filter(([key]) => key.startsWith(`${agentId}/`))
          .map(([, file]) => file),
        readWorkspaceFile: async (agentId: string, path: string) => runtimeWorkspaceFiles.get(`${agentId}/${path}`) ?? null,
        writeWorkspaceFile: async (agentId: string, file: { path: string; content: string; metadata?: Record<string, unknown> }) => {
          runtimeWorkspaceFiles.set(`${agentId}/${file.path}`, { path: file.path, content: file.content, metadata: file.metadata })
        },
        removeWorkspaceFile: async (agentId: string, path: string) => {
          runtimeWorkspaceFiles.delete(`${agentId}/${path}`)
        },
      },
    },
  }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { agentSyncComponent } from '../../../src/core/onboarding/agent-sync'
import { installPackage } from '../../../src/core/agent-packages/installer'
import {
  agentSyncRepair,
  checkAgentRoster,
  checkPersonas,
  checkAgentSync,
  checkTeamRouting,
  personaRepair,
} from '../../../plugins/team/lib/health-checks'

const runtimeAgentReader = {
  list: async () => {
    if (runtimeError) throw runtimeError
    return runtimeAgents
  },
}

function makeRuntimeAgent(id: string, name = id): RuntimeAgent {
  return { id, name, status: 'active' }
}

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  runtimeAgents = []
  runtimeAgentStore.clear()
  runtimeWorkspaceFiles.clear()
  runtimeError = null
})

// ─── checkTeamRouting (#189) ────────────────────────────────────────────────

describe('checkTeamRouting', () => {
  const board = (teams: Array<string | undefined>, column = 'todo') => () => ({
    columns: { [column]: teams.map((team, i) => ({ id: `t${i}`, team })) },
  })

  it('ignores RESOLVED team tasks — no warn when only team+agent tasks exist without a key (R7)', async () => {
    const readBoard = () => ({
      columns: { inProgress: [{ id: 't0', team: 'development', agent: 'reviewer' }] },
    })
    const results = await checkTeamRouting({
      routingProvider: 'anthropic',
      readBoard,
      keySource: () => null,
    })
    expect(results[0].status).toBe('ok')
  })

  it('passes quietly when no team-assigned tasks exist', async () => {
    const results = await checkTeamRouting({
      routingProvider: 'anthropic',
      readBoard: board([undefined, undefined]),
      keySource: () => null,
    })
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
  })

  it('warns when team tasks exist but no routing key resolves', async () => {
    const results = await checkTeamRouting({
      routingProvider: 'anthropic',
      readBoard: board(['development', undefined]),
      keySource: () => null,
    })
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toContain('anthropic')
  })

  it('passes when team tasks exist and the key resolves', async () => {
    const results = await checkTeamRouting({
      routingProvider: 'anthropic',
      readBoard: board(['development']),
      keySource: () => ({ apiKey: 'k', source: 'env' as const }),
    })
    expect(results[0].status).toBe('ok')
  })

  it('ignores done/archived team tasks', async () => {
    const results = await checkTeamRouting({
      routingProvider: 'anthropic',
      readBoard: board(['development'], 'done'),
      keySource: () => null,
    })
    expect(results[0].status).toBe('ok')
  })
})

// ─── checkAgentRoster ──────────────────────────────────────────────────────

describe('checkAgentRoster', () => {
  it('reports an error when the runtime roster cannot be read', async () => {
    runtimeError = new Error('adapter unavailable')
    const results = await checkAgentRoster(runtimeAgentReader)
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('agent-roster')
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/runtime agent roster/)
  })

  it('reports ok when runtime returns a coherent roster', async () => {
    runtimeAgents = [makeRuntimeAgent('main'), makeRuntimeAgent('patch')]
    const results = await checkAgentRoster(runtimeAgentReader)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/2 runtime agent/)
  })

  it('warns about duplicate runtime agent ids', async () => {
    runtimeAgents = [makeRuntimeAgent('main'), makeRuntimeAgent('main')]
    const results = await checkAgentRoster(runtimeAgentReader)
    expect(results.some(r => r.status === 'warn' && r.message.includes('Duplicate'))).toBe(true)
  })

  it('warns about runtime agents without ids', async () => {
    runtimeAgents = [{ id: '', name: 'Broken' }]
    const results = await checkAgentRoster(runtimeAgentReader)
    expect(results.some(r => r.status === 'warn' && r.message.includes('without an id'))).toBe(true)
  })
})

// ─── checkPersonas ─────────────────────────────────────────────────────────

describe('checkPersonas', () => {
  beforeEach(() => {
    runtimeAgents = [makeRuntimeAgent('main'), makeRuntimeAgent('patch'), makeRuntimeAgent('pixel')]
  })

  it('detects missing persona files', async () => {
    const personasDir = join(testDir, 'team', 'personas')
    mkdirSync(personasDir, { recursive: true })
    writeFileSync(join(personasDir, 'main.md'), '# Main')
    // patch and pixel are missing

    const results = await checkPersonas(testDir, runtimeAgentReader)
    const warnings = results.filter(r => r.status === 'warn')
    expect(warnings.length).toBeGreaterThanOrEqual(2) // patch + pixel missing
    expect(warnings.some(r => r.message.includes('patch'))).toBe(true)
    expect(warnings.some(r => r.message.includes('pixel'))).toBe(true)
  })

  it('reports ok when every agent has a persona', async () => {
    const personasDir = join(testDir, 'team', 'personas')
    mkdirSync(personasDir, { recursive: true })
    for (const agent of ['main', 'patch', 'pixel']) {
      writeFileSync(join(personasDir, `${agent}.md`), `# ${agent}`)
    }

    const results = await checkPersonas(testDir, runtimeAgentReader)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/All 3 agents/)
  })

  it('warns when the personas directory is missing (no autoFix)', async () => {
    const results = await checkPersonas(testDir, runtimeAgentReader)
    expect(results.some(r => r.status === 'warn' && r.message.includes('No personas directory'))).toBe(true)
  })

  it('does not create stub persona files during diagnostics', async () => {
    const personasDir = join(testDir, 'team', 'personas')
    mkdirSync(personasDir, { recursive: true })
    writeFileSync(join(personasDir, 'main.md'), '# Main')

    const results = await checkPersonas(testDir, runtimeAgentReader)
    expect(results.some(r => r.status === 'warn' && r.message.includes('patch'))).toBe(true)
    const after = readdirSync(personasDir)
    expect(after).not.toContain('patch.md')
    expect(after).not.toContain('pixel.md')
  })

  it('persona repair creates the personas directory and stub files explicitly', async () => {
    const personasDir = join(testDir, 'team', 'personas')
    expect(existsSync(personasDir)).toBe(false)

    const results = await checkPersonas(testDir, runtimeAgentReader)
    const repair = personaRepair(testDir, runtimeAgentReader)
    const plan = await repair.plan(results)
    expect(plan).toHaveLength(1)
    const applied = await repair.apply(plan)
    expect(applied[0].status).toBe('applied')
    expect(existsSync(personasDir)).toBe(true)
    expect(readdirSync(personasDir)).toEqual(expect.arrayContaining(['main.md', 'patch.md', 'pixel.md']))
    const stub = readFileSync(join(personasDir, 'patch.md'), 'utf-8')
    expect(stub).toMatch(/Persona not yet configured/)
  })
})

// ─── checkAgentSync — wrapper coverage ─────────────────────────────────────

describe('checkAgentSync — wrapper', () => {
  it('returns ok when the scanner reports a clean state', async () => {
    // Empty roster + empty lockfile + freshly seeded context files = clean.
    const { seedContextFiles } = await import('../../../src/core/team-context')
    seedContextFiles()
    const results = await checkAgentSync()
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('agent-sync')
    expect(results[0].status).toBe('ok')
  })

  it('reports stale role context as an auto-fixable warn', async () => {
    // No context files seeded → role-context-stale findings.
    const results = await checkAgentSync()
    expect(results.some((r) => r.status === 'warn' && r.autoFixable)).toBe(true)
  })

  it('plans a safe local-sync repair for auto-fixable findings and applies it', async () => {
    const results = await checkAgentSync()
    const repair = agentSyncRepair()
    const plan = await repair.plan(results)
    expect(plan.length).toBeGreaterThanOrEqual(1)
    const local = plan.find((p) => p.id === 'team.agent-sync.local')
    expect(local?.safety).toBe('safe')
    expect(local?.requiresConfirmation).toBe(false)

    const applied = await repair.apply([local!])
    expect(applied[0].status).toBe('applied')

    const after = await checkAgentSync()
    expect(after[0].status).toBe('ok')
  })

  it('plans the migration as a destructive, confirmation-required item', async () => {
    const { writeLockfile } = await import('../../../packages/core/src/agent-packages/lockfile')
    writeLockfile({
      version: 1,
      packages: {
        pixel: {
          kind: 'agent', version: '0.1.0', source: '/nowhere', ref: '', commitSha: '',
          installedAt: '2026-01-01T00:00:00Z', state: 'managed', agentId: 'pixel',
          projections: [
            { kind: 'workspace-file', target: 'runtime:workspace-file:pixel:SOUL.md', sha256: 'x', templateOnly: true },
          ],
        },
      },
    })
    const results = await checkAgentSync()
    expect(results.some((r) => r.message.includes('migration'))).toBe(true)

    const plan = await agentSyncRepair().plan(results)
    const migrate = plan.find((p) => p.id === 'team.agent-sync.migrate')
    expect(migrate?.safety).toBe('destructive')
    expect(migrate?.requiresConfirmation).toBe(true)
  })
})

// ─── checkAgentSync — integration via real component ──────────────────────
//
// Exercises the agent-sync onboarding component directly to verify drift
// detection and repair semantics that the wrapper depends on.

function seedAgentPackage(): string {
  const dir = join(testDir, 'pixel-pkg')
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'lessons'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id: 'pixel',
      kind: 'agent',
      name: 'Pixel',
      version: '0.1.0',
      agent: { identity: { name: 'Pixel' } },
      install: { writeWorkspaceFiles: true, enableLessons: ['style'] },
      contributions: {
        workspaceFiles: ['workspace/SOUL.md'],
        lessons: ['lessons/style.md'],
        assets: ['assets/avatar.jpg'],
      },
    }),
  )
  writeFileSync(
    join(dir, 'workspace', 'SOUL.md'),
    `# Soul Pixel\n\n<!-- bakin:lesson-catalog:start -->\n<!-- bakin:lesson-catalog:end -->\n`,
  )
  writeFileSync(
    join(dir, 'lessons', 'style.md'),
    `---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle body.`,
  )
  writeFileSync(join(dir, 'assets', 'avatar.jpg'), 'jpg-bytes')
  return dir
}

const NON_INTERACTIVE = {
  interactive: false,
  autoApprove: true,
  json: false,
  checkOnly: false,
  force: false,
}

describe('agent-sync component integration', () => {
  it('component check returns ok when projections match the lockfile', async () => {
    runtimeAgents = [{ id: 'main', name: 'Roscoe', status: 'active' }]
    const src = seedAgentPackage()
    await installPackage({ source: src })
    await agentSyncComponent.install(NON_INTERACTIVE) // settle unmanaged main

    const result = await agentSyncComponent.check()
    expect(result.status).toBe('ok')
  })

  it('component check returns warn when an asset is missing or drifted', async () => {
    runtimeAgents = [{ id: 'main', name: 'Roscoe', status: 'active' }]
    const src = seedAgentPackage()
    await installPackage({ source: src })
    await agentSyncComponent.install(NON_INTERACTIVE)

    // Mutate avatar.jpg — non-template projection sha drift
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    writeFileSync(avatar, 'corrupted-content')

    const result = await agentSyncComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('asset-drifted')
  })

  it('component install repairs a deleted asset in-place', async () => {
    runtimeAgents = [{ id: 'main', name: 'Roscoe', status: 'active' }]
    const src = seedAgentPackage()
    await installPackage({ source: src })
    await agentSyncComponent.install(NON_INTERACTIVE)

    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    rmSync(avatar)
    expect(existsSync(avatar)).toBe(false)

    const beforeCheck = await agentSyncComponent.check()
    expect(beforeCheck.status).toBe('error')
    expect(beforeCheck.message).toContain('asset-missing')

    const installResult = await agentSyncComponent.install(NON_INTERACTIVE)
    expect(['installed', 'noop']).toContain(installResult.status)

    expect(existsSync(avatar)).toBe(true)
    const afterCheck = await agentSyncComponent.check()
    expect(afterCheck.status).toBe('ok')
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────
//
// Spec deliverable from the doctor-decoupling work (shipped; see
// .claude/knowledge/doctor-and-health-checks.md). Catches the
// regression "I forgot to wire ctx.registerHealthCheck() in activate()" —
// the only failure mode the rest of the test suite cannot detect.

describe('plugin registration', () => {
  it('registers all owned health checks on activate', async () => {
    const teamPlugin = (await import('../../../plugins/team')).default
    const registeredIds: string[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'team',
      runtime: { agents: { list: mock(async () => []) } },
      registerRoute: noop,
      registerExecTool: noop,
      registerNav: noop,
      registerSlot: noop,
      registerSkill: noop,
      registerWorkflow: noop,
      registerNodeType: noop,
      registerNotificationChannel: noop,
      registerHealthCheck: (def: { id: string }) => { registeredIds.push(def.id); return `team.${def.id}` },
      watchFiles: noop,
      getSettings: () => ({}),
      updateSettings: noop,
      activity: { log: noop, audit: noop },
      hooks: { register: () => () => {}, has: () => false, invoke: noopAsync },
      search: {
        registerContentType: noop,
        registerFileBackedContentType: noop,
        index: noopAsync,
        remove: noopAsync,
        transform: noopAsync,
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } })),
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    await teamPlugin.activate(ctx as unknown as Parameters<typeof teamPlugin.activate>[0])

    expect(registeredIds).toContain('agent-roster')
    expect(registeredIds).toContain('personas')
    expect(registeredIds).toContain('agent-sync')
  })
})
