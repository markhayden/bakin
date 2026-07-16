/**
 * End-to-end coverage for the hot-reload feature (Phase 2 P2.C10).
 *
 * Exercises the full coordinator → pipeline → state-swap → SSE chain
 * in-process, without spawning a real bakin server. The build step is
 * stubbed to write a deterministic dist/index.mjs so the test controls
 * exactly what activate() does on each reload — chokidar's file-watch
 * mechanics aren't under test (those are chokidar's job), but the
 * orchestration around them is.
 *
 * Six scenarios from spec §8.3:
 *   1. Server route change — state.routes refreshes; version bumps.
 *   2. Build error → recovery — dev:plugin:error fires; old plugin
 *      stays registered with empty arrays; next successful build
 *      emits dev:plugin:recover then dev:plugin:reload.
 *   3. Activate throw → disabled state — sweep happens; recovery flow
 *      re-emits recover before reload.
 *   4. onShutdown throws → reload still completes.
 *   5. Cross-cutting save — multiple file events coalesce into a
 *      single follow-up cycle (per-plugin pipeline mutex).
 *   6. import() top-level throw — caught + dev:plugin:error fires.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-hot-reload-integration-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

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

// Build stub — writes a fresh dist/index.mjs based on whatever the
// test queued via writeNextDist(). Mirrors the real buildUserPlugin's
// post-condition (dist/index.mjs containing a module that
// default-exports a BakinPlugin) without invoking Bun.build.
let buildBehavior: 'ok' | 'throw' = 'ok'
let nextDistContent: string | null = null
const buildCalls: string[] = []
mock.module('../../../packages/host/src/plugin-host/user-plugin-builder', () => ({
  buildUserPlugin: async (pluginDir: string) => {
    buildCalls.push(pluginDir)
    if (buildBehavior === 'throw') {
      throw new Error('synthetic build failure')
    }
    if (nextDistContent === null) {
      throw new Error('test forgot to writeNextDist before triggering reload')
    }
    const distDir = join(pluginDir, 'dist')
    mkdirSync(distDir, { recursive: true })
    writeFileSync(join(distDir, 'index.mjs'), nextDistContent, 'utf-8')
  },
}))

import {
  __triggerReloadForTest,
  __resetCoordinatorForTest,
} from '../../../src/core/plugin-host/hot-reload-coordinator'
import {
  __resetReloadPipelineForTest,
} from '../../../src/core/plugin-host/reload-pipeline'
import { pluginRegistry } from '../../../src/core/plugin-registry'
import { __resetVersionsForTest, getVersion } from '../../../src/core/plugin-host/version-stamp'

let pluginRoot: string

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  pluginRoot = join(testDir, 'plugins', `fixture-${randomUUID()}`)
  mkdirSync(pluginRoot, { recursive: true })
  broadcasts.length = 0
  buildCalls.length = 0
  buildBehavior = 'ok'
  nextDistContent = null
  __resetCoordinatorForTest()
  __resetReloadPipelineForTest()
  __resetVersionsForTest()
  pluginRegistry._resetForTests()
})

interface SeedOptions {
  onShutdownThrows?: boolean
}

function seedRegistryEntry(opts: SeedOptions = {}): void {
  const state = {
    plugin: {
      id: 'fixture',
      name: 'Fixture',
      version: 'v0',
      activate: async () => {},
      onShutdown: opts.onShutdownThrows
        ? async () => { throw new Error('synthetic shutdown failure') }
        : async () => {},
    },
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
      registerRoute: (route: unknown) => { state.routes.push(route) },
      registerSlot: (slot: unknown) => { state.slots.push(slot) },
      registerExecTool: () => {},
      registerSkill: () => {},
      registerWorkflow: () => {},
      registerNodeType: () => 'fixture.kind',
      registerNotificationChannel: () => 'fixture.id',
      registerHealthCheck: (def: { id: string }) => `fixture.${def.id}`,
      registerHealthRepairAction: (def: { id: string }) => `fixture.${def.id}`,
      watchFiles: () => {},
      getSettings: () => ({}),
      updateSettings: () => {},
      activity: { log: () => {}, audit: () => {} },
      search: { index: async () => {}, remove: async () => {}, registerContentType: () => {}, registerFileBackedContentType: () => {} },
      hooks: { register: () => () => {}, has: () => false, invoke: async () => undefined },
    } as unknown,
  }
  const internal = pluginRegistry as unknown as { plugins: Map<string, unknown> }
  internal.plugins.set('fixture', state)
}

function distModule(opts: { activateThrows?: boolean; routePath?: string; importThrows?: boolean }): string {
  if (opts.importThrows) {
    return 'throw new Error("synthetic top-level import error")\n'
  }
  if (opts.activateThrows) {
    return `
      export default {
        id: 'fixture',
        name: 'Fixture',
        version: '0.0.0',
        activate: async () => { throw new Error('synthetic activate failure') },
      }
    `
  }
  const path = opts.routePath ?? '/'
  return `
    export default {
      id: 'fixture',
      name: 'Fixture',
      version: '0.0.0',
      activate: async (ctx) => {
        ctx.registerRoute({ method: 'GET', path: '${path}', description: 'auto', handler: async () => new Response('${path}') })
      },
    }
  `
}

function pluginState() {
  const state = pluginRegistry.getPluginState('fixture')
  if (!state) throw new Error('fixture plugin not registered')
  return state
}

function eventTypes(): string[] {
  return broadcasts.map((b) => b.type as string)
}

describe('hot-reload integration', () => {
  it('scenario 1: server route change — state.routes refreshes + version bumps', async () => {
    seedRegistryEntry()
    nextDistContent = distModule({ routePath: '/v1' })
    await __triggerReloadForTest('fixture', pluginRoot)

    expect(getVersion('fixture')).toBe(1)
    expect(pluginState().routes).toHaveLength(1)
    expect((pluginState().routes[0] as { path: string }).path).toBe('/v1')
    expect(eventTypes()).toContain('dev:plugin:reload')

    // Save again with a different route.
    nextDistContent = distModule({ routePath: '/v2' })
    broadcasts.length = 0
    await __triggerReloadForTest('fixture', pluginRoot)

    expect(getVersion('fixture')).toBe(2)
    expect(pluginState().routes).toHaveLength(1)
    expect((pluginState().routes[0] as { path: string }).path).toBe('/v2')
  })

  it('scenario 2: build error → recovery — error fires, old plugin remains, then recover + reload', async () => {
    seedRegistryEntry()
    // Initial successful reload to seed the version + state.
    nextDistContent = distModule({ routePath: '/v1' })
    await __triggerReloadForTest('fixture', pluginRoot)
    expect(getVersion('fixture')).toBe(1)

    // Save with a build that will throw.
    broadcasts.length = 0
    buildBehavior = 'throw'
    await __triggerReloadForTest('fixture', pluginRoot)
    expect(eventTypes()).toContain('dev:plugin:error')
    // No reload, no version bump.
    expect(eventTypes()).not.toContain('dev:plugin:reload')
    expect(getVersion('fixture')).toBe(1)

    // Fix the build, save again.
    buildBehavior = 'ok'
    nextDistContent = distModule({ routePath: '/v2' })
    broadcasts.length = 0
    await __triggerReloadForTest('fixture', pluginRoot)
    // The reload pipeline broadcasts dev:plugin:recover BEFORE
    // dev:plugin:reload when transitioning from error → success.
    const types = eventTypes()
    expect(types).toContain('dev:plugin:recover')
    expect(types).toContain('dev:plugin:reload')
    expect(types.indexOf('dev:plugin:recover')).toBeLessThan(types.indexOf('dev:plugin:reload'))
    expect(getVersion('fixture')).toBe(2)
  })

  it('scenario 3: activate throw → re-sweep + recover on next success', async () => {
    seedRegistryEntry()
    nextDistContent = distModule({ activateThrows: true })
    await __triggerReloadForTest('fixture', pluginRoot)
    expect(eventTypes()).toContain('dev:plugin:error')
    expect(pluginState().routes).toHaveLength(0)
    expect(getVersion('fixture')).toBe(0)

    // Fix.
    nextDistContent = distModule({ routePath: '/' })
    broadcasts.length = 0
    await __triggerReloadForTest('fixture', pluginRoot)
    expect(eventTypes()).toContain('dev:plugin:recover')
    expect(eventTypes()).toContain('dev:plugin:reload')
    expect(pluginState().routes).toHaveLength(1)
  })

  it('scenario 4: onShutdown throws → reload still completes successfully', async () => {
    seedRegistryEntry({ onShutdownThrows: true })
    nextDistContent = distModule({ routePath: '/' })
    await __triggerReloadForTest('fixture', pluginRoot)
    expect(eventTypes()).toContain('dev:plugin:reload')
    expect(getVersion('fixture')).toBe(1)
  })

  it('scenario 5: overlapping triggers coalesce into one follow-up cycle', async () => {
    seedRegistryEntry()
    nextDistContent = distModule({ routePath: '/v1' })

    // Fire three triggers synchronously. The first runs to completion,
    // the second sets pending=true, the third finds pending already
    // set and is a no-op. Expected: 2 builds total (initial + one
    // coalesced follow-up).
    const first = __triggerReloadForTest('fixture', pluginRoot)
    void __triggerReloadForTest('fixture', pluginRoot)
    void __triggerReloadForTest('fixture', pluginRoot)
    await first

    expect(buildCalls.length).toBe(2)
  })

  it('scenario 6: top-level import throw → dev:plugin:error', async () => {
    seedRegistryEntry()
    nextDistContent = distModule({ importThrows: true })
    await __triggerReloadForTest('fixture', pluginRoot)
    expect(eventTypes()).toContain('dev:plugin:error')
    expect(eventTypes()).not.toContain('dev:plugin:reload')
    expect(getVersion('fixture')).toBe(0)
  })
})
