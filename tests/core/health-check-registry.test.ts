/**
 * Health-check registry — unit tests for the store shape.
 *
 * Mirrors tests/plugins/workflows/notification-channel-registry.test.ts
 * but without any builtin-seeding assertions — this registry is
 * plugin-contributions-only.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-health-registry-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

import {
  registerHealthCheck,
  getHealthCheck,
  listHealthChecks,
  unregisterHealthCheck,
  registerPluginHealthCheck,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'

// Track ids we add per-test so we can clean up between tests.
const added: string[] = []
afterEach(() => {
  for (const id of added) unregisterHealthCheck(id)
  added.length = 0
})

describe('health-check-registry — baseline', () => {
  it('starts empty (no builtin self-seeding)', () => {
    expect(listHealthChecks()).toHaveLength(0)
  })
})

describe('health-check-registry — register / get / list', () => {
  it('registers and retrieves a check', () => {
    registerHealthCheck({
      runtime: 'plugin',
      pluginId: 'test',
      id: 'test.foo',
      name: 'Foo check',
      run: async () => [],
    })
    added.push('test.foo')
    const def = getHealthCheck('test.foo')
    expect(def).toBeDefined()
    expect(def!.name).toBe('Foo check')
    expect(def!.pluginId).toBe('test')
  })

  it('throws on duplicate id', () => {
    registerHealthCheck({
      runtime: 'plugin', pluginId: 'test', id: 'test.dupe', name: 'Dupe', run: async () => [],
    })
    added.push('test.dupe')
    expect(() =>
      registerHealthCheck({
        runtime: 'plugin', pluginId: 'test', id: 'test.dupe', name: 'Again', run: async () => [],
      }),
    ).toThrow(/already registered/)
  })

  it('returns undefined for unknown ids', () => {
    expect(getHealthCheck('nope')).toBeUndefined()
  })

  it('list returns all registered entries', () => {
    registerHealthCheck({
      runtime: 'plugin', pluginId: 'test', id: 'test.a', name: 'A', run: async () => [],
    })
    registerHealthCheck({
      runtime: 'plugin', pluginId: 'test', id: 'test.b', name: 'B', run: async () => [],
    })
    added.push('test.a', 'test.b')
    expect(listHealthChecks()).toHaveLength(2)
  })
})

describe('health-check-registry — plugin helper', () => {
  it('namespaces ids as {pluginId}.{id}', () => {
    const result = registerPluginHealthCheck('myplugin', {
      id: 'reachability',
      name: 'My reachability check',
      run: async () => [],
    })
    added.push(result)
    expect(result).toBe('myplugin.reachability')
    expect(getHealthCheck('myplugin.reachability')?.pluginId).toBe('myplugin')
  })

  it('preserves autoFix flag', () => {
    const result = registerPluginHealthCheck('myplugin', {
      id: 'cleanup',
      name: 'Cleanup check',
      autoFix: true,
      run: async () => [],
    })
    added.push(result)
    expect(getHealthCheck(result)?.autoFix).toBe(true)
  })

  it('defaults autoFix to undefined when not passed', () => {
    const result = registerPluginHealthCheck('myplugin', {
      id: 'readonly',
      name: 'Readonly check',
      run: async () => [],
    })
    added.push(result)
    expect(getHealthCheck(result)?.autoFix).toBeUndefined()
  })
})

describe('health-check-registry — plugin teardown', () => {
  it('unregisterPluginHealthChecks removes only the named plugin', () => {
    registerPluginHealthCheck('plugin-a', { id: 'one', name: 'A-one', run: async () => [] })
    registerPluginHealthCheck('plugin-a', { id: 'two', name: 'A-two', run: async () => [] })
    registerPluginHealthCheck('plugin-b', { id: 'one', name: 'B-one', run: async () => [] })

    unregisterPluginHealthChecks('plugin-a')

    expect(getHealthCheck('plugin-a.one')).toBeUndefined()
    expect(getHealthCheck('plugin-a.two')).toBeUndefined()
    expect(getHealthCheck('plugin-b.one')).toBeDefined()

    unregisterHealthCheck('plugin-b.one')  // cleanup
  })

  it('is idempotent — unregistering an unknown plugin is a no-op', () => {
    expect(() => unregisterPluginHealthChecks('never-registered')).not.toThrow()
  })
})
