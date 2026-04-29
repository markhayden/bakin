/**
 * Coverage for src/core/plugin-host/hot-reload-coordinator.ts (Phase 2
 * P2.C8). The full chokidar→build→reload integration lands in P2.C10's
 * end-to-end test; this file exercises the unit-level concerns:
 *
 *   - resolveWatchTargets honors devWatch in the manifest, preserves
 *     explicit globs, falls back to the curated default when absent, and
 *     skips literal paths that don't exist on disk.
 *   - The per-plugin pipeline mutex coalesces overlapping triggers
 *     into a single follow-up cycle (inflight + pending pattern).
 *   - Successive triggers for the same id never overlap.
 *   - startHotReloadCoordinator is idempotent.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-coordinator-${Date.now()}-${randomUUID()}`)
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

// Capture broadcasts.
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

// Track build invocations and let tests inject an artificial delay so
// concurrent triggers actually race in a deterministic way.
const buildSpy = {
  calls: 0,
  delayMs: 0,
  shouldThrow: false,
}
mock.module('../../../packages/host/src/plugin-host/user-plugin-builder', () => ({
  buildUserPlugin: async () => {
    buildSpy.calls += 1
    if (buildSpy.delayMs > 0) {
      await new Promise((r) => setTimeout(r, buildSpy.delayMs))
    }
    if (buildSpy.shouldThrow) throw new Error('synthetic build failure')
  },
}))

// The reload pipeline is exercised in its own test file; here we stub it
// out so the coordinator's queue behavior can be observed in isolation.
const reloadSpy = {
  calls: 0,
  ok: true,
}
mock.module('../../../src/core/plugin-host/reload-pipeline', () => ({
  runReloadPipeline: async () => {
    reloadSpy.calls += 1
    return { ok: reloadSpy.ok, version: reloadSpy.calls, ...(reloadSpy.ok ? {} : { error: 'stub', failedAt: 'activate' }) }
  },
  __resetReloadPipelineForTest: () => {},
}))

import {
  resolveWatchTargets,
  __matchesWatchTargetForTest,
  startHotReloadCoordinator,
  stopHotReloadCoordinator,
  __triggerReloadForTest,
  __resetCoordinatorForTest,
} from '../../../src/core/plugin-host/hot-reload-coordinator'

const pluginRoot = join(testDir, 'plugins', 'fixture')

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(pluginRoot, { recursive: true, force: true })
  mkdirSync(pluginRoot, { recursive: true })
  broadcasts.length = 0
  buildSpy.calls = 0
  buildSpy.delayMs = 0
  buildSpy.shouldThrow = false
  reloadSpy.calls = 0
  reloadSpy.ok = true
  __resetCoordinatorForTest()
})

describe('resolveWatchTargets', () => {
  it('falls back to default paths when manifest omits devWatch', () => {
    writeFileSync(join(pluginRoot, 'bakin-plugin.json'), JSON.stringify({ id: 'x', name: 'X', version: '0.0.0' }))
    writeFileSync(join(pluginRoot, 'index.ts'), '// stub')
    mkdirSync(join(pluginRoot, 'components'), { recursive: true })

    const targets = resolveWatchTargets(pluginRoot)
    // index.ts + bakin-plugin.json + components/ all exist; package.json
    // doesn't (skipped). The default list yields these matches.
    expect(targets).toContain(join(pluginRoot, 'index.ts'))
    expect(targets).toContain(join(pluginRoot, 'bakin-plugin.json'))
    expect(targets).toContain(join(pluginRoot, 'components'))
    // package.json wasn't created → not included.
    expect(targets.some((p) => p.endsWith('package.json'))).toBe(false)
  })

  it('honors manifest devWatch when present', () => {
    writeFileSync(join(pluginRoot, 'bakin-plugin.json'), JSON.stringify({
      id: 'x', name: 'X', version: '0.0.0',
      devWatch: ['custom-src', 'special.ts'],
    }))
    mkdirSync(join(pluginRoot, 'custom-src'), { recursive: true })
    writeFileSync(join(pluginRoot, 'special.ts'), '// stub')

    const targets = resolveWatchTargets(pluginRoot)
    expect(targets).toEqual([
      join(pluginRoot, 'custom-src'),
      join(pluginRoot, 'special.ts'),
    ])
  })

  it('preserves manifest devWatch globs for chokidar', () => {
    writeFileSync(join(pluginRoot, 'bakin-plugin.json'), JSON.stringify({
      id: 'x', name: 'X', version: '0.0.0',
      devWatch: ['**/*.ts', '**/*.tsx', 'bakin-plugin.json'],
    }))

    const targets = resolveWatchTargets(pluginRoot)
    expect(targets).toEqual([
      join(pluginRoot, '**/*.ts'),
      join(pluginRoot, '**/*.tsx'),
      join(pluginRoot, 'bakin-plugin.json'),
    ])
  })

  it('handles malformed manifest gracefully', () => {
    writeFileSync(join(pluginRoot, 'bakin-plugin.json'), 'not-json{{{')
    writeFileSync(join(pluginRoot, 'index.ts'), '// stub')
    const targets = resolveWatchTargets(pluginRoot)
    expect(targets).toContain(join(pluginRoot, 'index.ts'))
  })

  it('matches recursive manifest globs after chokidar v5 root-watch events', () => {
    expect(__matchesWatchTargetForTest(
      pluginRoot,
      join(pluginRoot, 'components', 'empty-state.tsx'),
      ['**/*.ts', '**/*.tsx', 'bakin-plugin.json'],
    )).toBe(true)
    expect(__matchesWatchTargetForTest(
      pluginRoot,
      join(pluginRoot, 'client.tsx'),
      ['**/*.ts', '**/*.tsx', 'bakin-plugin.json'],
    )).toBe(true)
    expect(__matchesWatchTargetForTest(
      pluginRoot,
      join(pluginRoot, 'styles.css'),
      ['**/*.ts', '**/*.tsx', 'bakin-plugin.json'],
    )).toBe(false)
  })

  it('matches literal directory watch entries for nested file changes', () => {
    expect(__matchesWatchTargetForTest(
      pluginRoot,
      join(pluginRoot, 'components', 'empty-state.tsx'),
      ['components'],
    )).toBe(true)
    expect(__matchesWatchTargetForTest(
      pluginRoot,
      join(pluginRoot, 'lib', 'service.ts'),
      ['components'],
    )).toBe(false)
  })
})

describe('per-plugin pipeline mutex', () => {
  it('serializes overlapping triggers — second runs after first finishes', async () => {
    writeFileSync(join(pluginRoot, 'bakin-plugin.json'), JSON.stringify({ id: 'fixture', name: 'F', version: '0.0.0' }))

    // Slow build so the second trigger arrives mid-flight.
    buildSpy.delayMs = 60
    const first = __triggerReloadForTest('fixture', pluginRoot)
    // Two more triggers while first is in-flight should coalesce into
    // a single follow-up cycle (the second sets pending=true; the third
    // finds pending already set and is a no-op).
    void __triggerReloadForTest('fixture', pluginRoot)
    void __triggerReloadForTest('fixture', pluginRoot)
    await first

    expect(buildSpy.calls).toBe(2) // initial + one coalesced follow-up
    expect(reloadSpy.calls).toBe(2)
  })

  it('build failure broadcasts dev:plugin:error and skips reload', async () => {
    writeFileSync(join(pluginRoot, 'bakin-plugin.json'), JSON.stringify({ id: 'fixture', name: 'F', version: '0.0.0' }))
    buildSpy.shouldThrow = true

    await __triggerReloadForTest('fixture', pluginRoot)
    expect(buildSpy.calls).toBe(1)
    expect(reloadSpy.calls).toBe(0)
    const errEvent = broadcasts.find((b) => b.type === 'dev:plugin:error')
    expect(errEvent).toBeDefined()
    expect((errEvent as { pluginId: string }).pluginId).toBe('fixture')
  })

  it('reload returns !ok — coordinator continues; pipeline already broadcast the error', async () => {
    writeFileSync(join(pluginRoot, 'bakin-plugin.json'), JSON.stringify({ id: 'fixture', name: 'F', version: '0.0.0' }))
    reloadSpy.ok = false

    await __triggerReloadForTest('fixture', pluginRoot)
    expect(buildSpy.calls).toBe(1)
    expect(reloadSpy.calls).toBe(1)
    // The pipeline owns the dev:plugin:error broadcast in this branch;
    // the coordinator just logs + returns, leaving the watcher live.
  })
})

describe('startHotReloadCoordinator', () => {
  it('is idempotent', () => {
    const first = startHotReloadCoordinator()
    const second = startHotReloadCoordinator()
    expect(first).toBe(true)
    expect(second).toBe(true)
  })

  it('reads no plugins when lockfile is missing — does not throw', async () => {
    expect(() => startHotReloadCoordinator()).not.toThrow()
    await stopHotReloadCoordinator()
  })
})
