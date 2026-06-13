/**
 * The unified PluginContext factory (WS2 K3). Focus: the convergence fix —
 * updateSettings fires onSettingsChange on BOTH the activate-time and the
 * per-request paths (the old per-request buildCtx silently skipped it).
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-ctx-factory-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))
// Keep the factory's heavy collaborators inert — we only exercise settings.
mock.module('../../src/core/search-registry', () => ({ buildSearchAPI: () => ({}) }))
mock.module('../../src/lib/plugin-context-services', () => ({
  createPluginAssetsAPI: () => ({}),
  createPluginRuntimeFacade: (r: unknown) => r,
  createPluginTaskService: (s: unknown) => s,
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({ register: () => () => {}, call: async (_n: string, d: unknown) => d, callAll: async () => {}, has: () => false, invoke: async () => undefined }),
}))
// Permission wrap is identity for this test (core source, no manifest perms).
mock.module('../../src/lib/plugin-permissions', () => ({ wrapPluginContextPermissions: (ctx: unknown) => ctx }))

import { buildPluginContext, noopRegistrars } from '../../src/lib/plugin-context-factory'

const services = { runtime: {}, search: {}, tasks: {} } as never
const events = {} as never

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('buildPluginContext settings', () => {
  it('updateSettings persists the merge AND fires onSettingsChange (per-request convergence)', () => {
    const changed: Array<Record<string, unknown>> = []
    const ctx = buildPluginContext({
      pluginId: 'demo',
      source: 'core',
      services,
      storage: {} as never,
      events,
      registrars: noopRegistrars('demo'),
      skipFileBackedWiring: true,
      auditSource: 'rest',
      onSettingsChange: (merged) => changed.push(merged),
      manifestPermissions: [],
    })

    ctx.updateSettings({ a: 1 })
    ctx.updateSettings({ b: 2 })

    // Notification fired on every write.
    expect(changed).toEqual([{ a: 1 }, { a: 1, b: 2 }])
    // And the merge is persisted.
    const file = join(testDir, 'plugin-settings', 'demo.json')
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ a: 1, b: 2 })
    // getSettings reads it back.
    expect(ctx.getSettings()).toEqual({ a: 1, b: 2 })
  })

  it('omitting onSettingsChange is safe (no throw)', () => {
    const ctx = buildPluginContext({
      pluginId: 'demo2',
      source: 'core',
      services,
      storage: {} as never,
      events,
      registrars: noopRegistrars('demo2'),
      manifestPermissions: [],
    })
    expect(() => ctx.updateSettings({ x: true })).not.toThrow()
    expect(ctx.getSettings()).toEqual({ x: true })
  })
})
