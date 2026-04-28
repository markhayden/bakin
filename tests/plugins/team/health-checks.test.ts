/**
 * Team-plugin-owned doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#139 C1) — these three checks
 * (agent-roster, personas, agent-assets) now live under the team
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
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

let mockAutoFix = false
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    doctor: { autoFixSkill: mockAutoFix },
  }),
  resetSettingsCache: () => {},
}))
mock.module('@/core/settings', () => ({
  getSettings: () => ({
    doctor: { autoFixSkill: mockAutoFix },
  }),
  resetSettingsCache: () => {},
}))

let openClawAgents: Array<{ id: string; identity?: { name?: string } }> = []
let runtimeAgents: RuntimeAgent[] = []
let runtimeError: Error | null = null
mock.module('@bakin/core/openclaw-config', () => ({
  readOpenClawConfig: () => ({ agents: { list: openClawAgents } }),
  resetOpenClawConfigCache: () => {},
  getAgentList: () => openClawAgents,
  getAgentIds: () => openClawAgents.map((a) => a.id),
  findAgentById: (id: string) => openClawAgents.find((a) => a.id === id) ?? null,
}))
mock.module('../../../packages/core/src/openclaw-config', () => ({
  readOpenClawConfig: () => ({ agents: { list: openClawAgents } }),
  resetOpenClawConfigCache: () => {},
  getAgentList: () => openClawAgents,
  getAgentIds: () => openClawAgents.map((a) => a.id),
  findAgentById: (id: string) => openClawAgents.find((a) => a.id === id) ?? null,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { agentAssetsComponent } from '../../../src/core/onboarding/agent-assets'
import { installPackage } from '../../../src/core/agent-packages/installer'
import {
  checkAgentRoster,
  checkPersonas,
  checkAgentAssets,
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
  openClawAgents = []
  runtimeAgents = []
  runtimeError = null
  mockAutoFix = false
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
    openClawAgents = [{ id: 'main' }, { id: 'patch' }, { id: 'pixel' }]
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

  it('creates stub persona files in autoFix mode', async () => {
    mockAutoFix = true
    const personasDir = join(testDir, 'team', 'personas')
    mkdirSync(personasDir, { recursive: true })
    writeFileSync(join(personasDir, 'main.md'), '# Main')

    const results = await checkPersonas(testDir, runtimeAgentReader)
    const fixes = results.filter(r => r.status === 'fixed')
    expect(fixes.length).toBeGreaterThan(0)
    // Stubs were written
    const after = readdirSync(personasDir)
    expect(after).toContain('patch.md')
    expect(after).toContain('pixel.md')
    const stub = readFileSync(join(personasDir, 'patch.md'), 'utf-8')
    expect(stub).toMatch(/Persona not yet configured/)
  })

  it('creates the personas directory in autoFix mode when missing', async () => {
    mockAutoFix = true
    const personasDir = join(testDir, 'team', 'personas')
    expect(existsSync(personasDir)).toBe(false)

    const results = await checkPersonas(testDir, runtimeAgentReader)
    expect(existsSync(personasDir)).toBe(true)
    expect(results.some(r => r.status === 'fixed' && r.message.includes('Created missing personas directory'))).toBe(true)
  })
})

// ─── checkAgentAssets — wrapper coverage ──────────────────────────────────

describe('checkAgentAssets — wrapper', () => {
  // Spy on the singleton's `check` method instead of mutating the export.
  // bun:test's spyOn restoration is automatic per `afterEach` and survives
  // assertion throws — fixes the fragility flagged in PR #173 review.
  let checkSpy: ReturnType<typeof spyOn> | null = null
  afterEach(() => {
    if (checkSpy) {
      checkSpy.mockRestore()
      checkSpy = null
    }
  })

  it('returns ok when component check returns ok', async () => {
    checkSpy = spyOn(agentAssetsComponent, 'check').mockImplementation(async () => ({
      name: 'agent-assets',
      status: 'ok' as const,
      message: 'no projections',
    }))
    const results = await checkAgentAssets()
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('agent-assets')
    expect(results[0].status).toBe('ok')
  })

  it('returns warn with reminder when component reports drift and autoFix=false', async () => {
    checkSpy = spyOn(agentAssetsComponent, 'check').mockImplementation(async () => ({
      name: 'agent-assets',
      status: 'warn' as const,
      message: '1 projection drifted',
      remediation: 'Run `bakin install agent-assets` to repair.',
    }))
    const results = await checkAgentAssets()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/bakin install agent-assets/)
  })
})

// ─── checkAgentAssets — integration via real component ────────────────────
//
// Absorbed from tests/core/doctor-agent-assets.test.ts. Exercises the
// agent-assets onboarding component directly to verify drift detection
// and repair semantics that the wrapper depends on.

function seedAgentPackage(): string {
  const dir = join(testDir, 'pixel-pkg')
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'knowledge'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id: 'pixel',
      kind: 'agent',
      name: 'Pixel',
      version: '0.1.0',
      agent: { identity: { name: 'Pixel' } },
      install: { writeWorkspaceFiles: true, enableKnowledge: ['style'] },
      contributions: {
        workspaceFiles: ['workspace/SOUL.md'],
        knowledge: ['knowledge/style.md'],
        assets: ['assets/avatar.jpg'],
      },
    }),
  )
  writeFileSync(
    join(dir, 'workspace', 'SOUL.md'),
    `# Soul Pixel\n\n<!-- bakin:knowledge-catalog:start -->\n<!-- bakin:knowledge-catalog:end -->\n`,
  )
  writeFileSync(
    join(dir, 'knowledge', 'style.md'),
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

describe('agent-assets component integration', () => {
  it('component check returns ok when projections match the lockfile', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    const result = await agentAssetsComponent.check()
    expect(result.status).toBe('ok')
  })

  it('component check returns warn when an asset is missing or drifted', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    // Mutate avatar.jpg — non-template projection sha drift
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    writeFileSync(avatar, 'corrupted-content')

    const result = await agentAssetsComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('drifted')
  })

  it('component install in autoFix mode repairs non-template drift in-place', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    // Delete an asset projection (avatar.jpg) — non-template, so update
    // mode repairs it. Workspace files (SOUL.md / IDENTITY.md / etc.)
    // are templateOnly and only repaired via --refresh-template; the
    // doctor's autoFix path doesn't pass that flag because the agent
    // may have legitimately edited those files post-install.
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    rmSync(avatar)
    expect(existsSync(avatar)).toBe(false)

    const beforeCheck = await agentAssetsComponent.check()
    expect(beforeCheck.status).toBe('warn')
    expect(beforeCheck.message).toContain('missing')

    const installResult = await agentAssetsComponent.install(NON_INTERACTIVE)
    expect(['installed', 'noop']).toContain(installResult.status)

    // Avatar is back
    expect(existsSync(avatar)).toBe(true)

    // And the post-repair check is clean
    const afterCheck = await agentAssetsComponent.check()
    expect(afterCheck.status).toBe('ok')
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────
//
// Spec deliverable per .claude/specs/doctor-decoupling.md §7. Catches the
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
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    await teamPlugin.activate(ctx as unknown as Parameters<typeof teamPlugin.activate>[0])

    expect(registeredIds).toContain('agent-roster')
    expect(registeredIds).toContain('personas')
    expect(registeredIds).toContain('agent-assets')
  })
})
