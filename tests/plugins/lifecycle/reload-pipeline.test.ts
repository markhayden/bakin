/**
 * Coverage for src/core/plugin-host/reload-pipeline.ts (Phase 2 P2.C7).
 *
 * Verifies the in-process plugin swap contract:
 *   - sweep clears the state arrays (routes/slots/healthCheckIds/etc.)
 *   - cache-bust import resolves freshly (?v=N)
 *   - activate() throw triggers re-sweep + dev:plugin:error broadcast
 *   - success bumps version + broadcasts dev:plugin:reload
 *   - recovering from a prior error broadcasts dev:plugin:recover first
 *
 * The pipeline talks to the live pluginRegistry; tests pre-seed a
 * synthetic plugin entry directly in the registry to avoid having to
 * spin up a full BakinPlugin via initialize().
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-reload-pipeline-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// Capture the SSE broadcasts the pipeline emits. The real broadcast()
// runs on the live SSE clients map; for tests we just observe what
// would have been pushed.
const broadcasts: Array<Record<string, unknown>> = []
mock.module('@/core/sse', () => ({
  broadcast: (data: Record<string, unknown>) => { broadcasts.push(data) },
  broadcastPluginReload: (pluginId: string, version: number) => {
    broadcasts.push({ type: 'dev:plugin:reload', pluginId, version })
  },
  broadcastPluginError: (pluginId: string, message: string) => {
    broadcasts.push({ type: 'dev:plugin:error', pluginId, message })
  },
  broadcastPluginRecover: (pluginId: string) => {
    broadcasts.push({ type: 'dev:plugin:recover', pluginId })
  },
}))

import {
  runReloadPipeline,
  __resetReloadPipelineForTest,
} from '../../../src/core/plugin-host/reload-pipeline'
import { pluginRegistry } from '../../../src/core/plugin-registry'
import { getAllRoutes, _resetRouteDocsForTests } from '../../../src/core/api-docs'

const registeredSkills: string[] = []
import { __resetVersionsForTest, getVersion } from '../../../src/core/plugin-host/version-stamp'

// Each test gets its own pluginRoot under a random subdir so Bun's
// module cache (keyed on the resolved path + ?v= query string) doesn't
// hand back a previous test's module when both happen to resolve to the
// same v=1 import URL.
let pluginRoot: string
let distPath: string

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  pluginRoot = join(testDir, 'plugins', `fixture-${randomUUID()}`)
  distPath = join(pluginRoot, 'dist')
  mkdirSync(distPath, { recursive: true })
  broadcasts.length = 0
  registeredSkills.length = 0
  _resetRouteDocsForTests()
  __resetVersionsForTest()
  __resetReloadPipelineForTest()
  // Reset the registry for an idempotent baseline. _resetForTests is
  // already provided for this purpose.
  pluginRegistry._resetForTests()
})

function writeFixture(version: 'v1' | 'v2' | 'throws-activate' | 'broken-import'): void {
  // ESM .mjs so `await import()` returns a real Module Namespace with
  // a working `default` export — Bun's CommonJS interop returns the
  // module.exports object directly, which would skip our default-export
  // resolver and cause spurious "no usable BakinPlugin export" failures.
  const filePath = join(distPath, 'index.mjs')
  if (version === 'broken-import') {
    writeFileSync(filePath, 'throw new Error("synthetic top-level import error")\n', 'utf-8')
    return
  }
  if (version === 'throws-activate') {
    writeFileSync(filePath, `
      export default {
        id: 'fixture',
        name: 'Fixture',
        version: '${version}',
        activate: async () => { throw new Error('synthetic activate failure') },
      }
    `, 'utf-8')
    return
  }
  // Declarative routes — the only route style since the legacy
  // ctx.registerRoute removal. The reload pipeline must re-register these
  // itself (boot does it in finalizeActivation, outside activate()).
  writeFileSync(filePath, `
    export default {
      id: 'fixture',
      name: 'Fixture',
      version: '${version}',
      routes: [
        { method: 'GET', path: '/', description: '${version}', handler: async () => new Response('${version}') },
      ],
      activate: async (ctx) => {
        ctx.registerHealthCheck({ id: 'reach', name: 'Reach', run: async () => [] })
      },
    }
  `, 'utf-8')
}

interface SeedOptions {
  initialActivate?: (ctx: unknown) => void | Promise<void>
  onShutdown?: () => void | Promise<void>
  source?: 'core' | 'user'
  manifest?: Record<string, unknown>
}

/**
 * Pre-seed the registry with a synthetic plugin entry whose state we
 * can mutate directly. Mirrors the shape PluginRegistryImpl.initialize
 * builds, minus the dependencies on the full storage/events plumbing.
 */
function seedRegistryEntry(opts: SeedOptions = {}): void {
  const state = {
    plugin: {
      id: 'fixture',
      name: 'Fixture',
      version: 'v0',
      activate: async () => {},
      onShutdown: opts.onShutdown ?? (async () => {}),
    },
    source: opts.source,
    manifest: opts.manifest,
    description: '',
    navItems: [] as unknown[],
    routes: [] as unknown[],
    slots: [] as unknown[],
    watchPatterns: [] as string[],
    nodeKinds: [] as string[],
    channelIds: [] as string[],
    healthCheckIds: [] as string[],
    healthRepairActionIds: [] as string[],
    ctx: {
      pluginId: 'fixture',
      registerNav: () => {},
      registerSlot: (slot: unknown) => { state.slots.push(slot) },
      registerExecTool: () => {},
      registerSkill: (skill: { name: string }) => { registeredSkills.push(skill.name) },
      registerWorkflow: () => {},
      registerNodeType: () => 'fixture.kind',
      registerNotificationChannel: () => 'fixture.id',
      registerHealthCheck: (def: { id: string }) => {
        const ns = `fixture.${def.id}`
        state.healthCheckIds.push(ns)
        return ns
      },
      registerHealthRepairAction: (def: { id: string }) => `fixture.${def.id}`,
      watchFiles: () => {},
      getSettings: () => ({}),
      updateSettings: () => {},
      activity: { log: () => {}, audit: () => {} },
      search: { index: async () => {}, remove: async () => {}, registerContentType: () => {}, registerFileBackedContentType: () => {} },
      hooks: { register: () => () => {}, has: () => false, invoke: async () => undefined },
    } as unknown,
    storage: {} as unknown,
    events: {} as unknown,
  }
  // Reach into the registry's private map. The pluginRegistry singleton is
  // a class instance; we mutate through `getPluginState` which returns the
  // very object we hand to the underlying Map.set, so set it via a small
  // typed cast.
  const internal = pluginRegistry as unknown as { plugins: Map<string, unknown> }
  internal.plugins.set('fixture', state)
}

describe('runReloadPipeline — happy path', () => {
  it('imports + activates the new module and bumps the version', async () => {
    writeFixture('v1')
    seedRegistryEntry()

    const result = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(result.ok).toBe(true)
    expect(result.version).toBe(1)
    expect(getVersion('fixture')).toBe(1)

    const state = pluginRegistry.getPluginState('fixture')!
    expect(state.routes.length).toBe(1)
    expect(state.healthCheckIds).toEqual(['fixture.reach'])
    expect((state.plugin as { version: string }).version).toBe('v1')

    const reloadEvent = broadcasts.find((b) => b.type === 'dev:plugin:reload')
    expect(reloadEvent).toEqual({ type: 'dev:plugin:reload', pluginId: 'fixture', version: 1 })
  })

  it('subsequent reload bumps the version monotonically', async () => {
    writeFixture('v1')
    seedRegistryEntry()
    await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })

    writeFixture('v2')
    const result = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(result.ok).toBe(true)
    expect(result.version).toBe(2)
    const state = pluginRegistry.getPluginState('fixture')!
    expect(state.routes.length).toBe(1) // sweep cleared, re-activate added one
    expect((state.plugin as { version: string }).version).toBe('v2')
  })

  it('emits dev:plugin:recover when reloading after a previous failure', async () => {
    writeFixture('throws-activate')
    seedRegistryEntry()
    const failed = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(failed.ok).toBe(false)
    expect(failed.failedAt).toBe('activate')

    writeFixture('v1')
    broadcasts.length = 0
    const ok = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(ok.ok).toBe(true)
    const types = broadcasts.map((b) => b.type)
    expect(types).toContain('dev:plugin:recover')
    expect(types).toContain('dev:plugin:reload')
    // Recover must be broadcast BEFORE the reload event so the client can
    // clear its overlay before swapping bundles.
    const recoverIdx = types.indexOf('dev:plugin:recover')
    const reloadIdx = types.indexOf('dev:plugin:reload')
    expect(recoverIdx).toBeLessThan(reloadIdx)
  })
})

describe('runReloadPipeline — failure modes', () => {
  it('returns failedAt=not-registered when the plugin is missing', async () => {
    writeFixture('v1')
    const result = await runReloadPipeline({ pluginId: 'absent', dir: pluginRoot })
    expect(result.ok).toBe(false)
    expect(result.failedAt).toBe('not-registered')
  })

  it('catches a top-level import error + broadcasts dev:plugin:error', async () => {
    writeFixture('broken-import')
    seedRegistryEntry()

    const result = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(result.ok).toBe(false)
    expect(result.failedAt).toBe('import')
    const errEvent = broadcasts.find((b) => b.type === 'dev:plugin:error')
    expect(errEvent).toBeDefined()
    expect((errEvent as { pluginId: string }).pluginId).toBe('fixture')
    // Version did NOT bump — the bumpVersion call is gated on success.
    expect(getVersion('fixture')).toBe(0)
  })

  it('catches an activate() throw + re-sweeps state arrays', async () => {
    writeFixture('throws-activate')
    seedRegistryEntry()

    const result = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(result.ok).toBe(false)
    expect(result.failedAt).toBe('activate')
    const state = pluginRegistry.getPluginState('fixture')!
    expect(state.routes.length).toBe(0)
    expect(state.healthCheckIds.length).toBe(0)
    const errEvent = broadcasts.find((b) => b.type === 'dev:plugin:error')
    expect(errEvent).toBeDefined()
  })

  it('continues the swap even when the OLD plugin onShutdown throws', async () => {
    writeFixture('v1')
    seedRegistryEntry({
      onShutdown: async () => { throw new Error('synthetic shutdown failure') },
    })

    const result = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(result.ok).toBe(true)
    expect(result.version).toBe(1)
  })
})

describe('runReloadPipeline — boot-parity registrations (declarative routes + skills)', () => {
  it('re-registers declarative routes and dedupes route docs across consecutive reloads', async () => {
    writeFixture('v1')
    seedRegistryEntry()

    expect((await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })).ok).toBe(true)
    let state = pluginRegistry.getPluginState('fixture')!
    expect(state.routes.length).toBe(1)
    expect((state.routes[0] as { method: string; path: string }).method).toBe('GET')

    // Second reload: routes must be re-registered again (sweep clears them),
    // and the /api/docs surface must not grow per reload cycle.
    writeFixture('v2')
    expect((await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })).ok).toBe(true)
    state = pluginRegistry.getPluginState('fixture')!
    expect(state.routes.length).toBe(1)
    expect((state.routes[0] as { description: string }).description).toBe('v2')

    const fixtureDocs = getAllRoutes().filter((d) => d.path.includes('fixture') || d.description === 'v2' || d.description === 'v1')
    expect(fixtureDocs.length).toBe(1)
    expect(fixtureDocs[0]!.description).toBe('v2')
  })

  it('re-runs the plugin-dir workflow-skill loader after activate', async () => {
    writeFixture('v1')
    seedRegistryEntry()
    const skillsDir = join(pluginRoot, 'defaults', 'workflow-skills')
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(join(skillsDir, 'demo-skill.md'), '# Demo skill\nDo the demo.\n', 'utf-8')

    const result = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(result.ok).toBe(true)
    expect(registeredSkills).toContain('demo-skill')
  })

  it('user plugins: undeclared declarative route fails the reload with the manifest hint', async () => {
    writeFixture('v1')
    seedRegistryEntry({ source: 'user', manifest: { contributes: { apiRoutes: [] } } })

    const result = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(result.ok).toBe(false)
    expect(result.failedAt).toBe('activate')
    expect(result.error).toContain('undeclared API route')
    // Failed reload leaves no partial registrations behind.
    expect(pluginRegistry.getPluginState('fixture')!.routes.length).toBe(0)
  })

  it('user plugins: declared declarative route reloads clean', async () => {
    writeFixture('v1')
    seedRegistryEntry({ source: 'user', manifest: { contributes: { apiRoutes: [{ method: 'GET', path: '/' }] } } })

    const result = await runReloadPipeline({ pluginId: 'fixture', dir: pluginRoot })
    expect(result.ok).toBe(true)
    expect(pluginRegistry.getPluginState('fixture')!.routes.length).toBe(1)
  })
})
