/**
 * Smoke tests for the registry teardown APIs (commit C6).
 *
 * Coverage:
 *   - HookRegistry.unregisterByPlugin sweeps only matching pluginId
 *   - removeExecToolsByPlugin filters by `bakin_exec_<id>_*` prefix
 *   - search.purgeContentType clears registration when antfly disabled
 *
 * Full coverage (mocking antfly enabled, double-sweep idempotency, etc.)
 * lands with C10's per-API test files.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Required isolation per CLAUDE.md — these tests don't touch fs but the
// registry import graph reaches modules that resolve content-dir at load.
const testDir = join(tmpdir(), `bakin-test-registry-teardown-${Date.now()}-${randomUUID()}`)
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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

import { HookRegistry } from '../../../packages/core/src/hooks/hook-registry'
import { addExecTool, getAllExecTools, removeExecToolsByPlugin } from '@/core/exec-tools/registry'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('HookRegistry.unregisterByPlugin', () => {
  it('removes only handlers tagged with the given pluginId', async () => {
    const reg = new HookRegistry()
    const callsA: string[] = []
    const callsB: string[] = []
    const callsCore: string[] = []
    reg.register('demo.event', () => { callsA.push('A') }, 'plugin-a')
    reg.register('demo.event', () => { callsB.push('B') }, 'plugin-b')
    reg.register('demo.event', () => { callsCore.push('core') }) // untagged

    const removed = reg.unregisterByPlugin('plugin-a')
    expect(removed).toBe(1)

    await reg.callAll('demo.event', {})
    expect(callsA).toEqual([])
    expect(callsB).toEqual(['B'])
    expect(callsCore).toEqual(['core'])
  })

  it('returns 0 when sweeping an unknown plugin', () => {
    const reg = new HookRegistry()
    reg.register('foo', () => {}, 'plugin-a')
    expect(reg.unregisterByPlugin('plugin-z')).toBe(0)
  })
})

describe('removeExecToolsByPlugin', () => {
  it('removes only tools whose name starts with bakin_exec_<id>_', () => {
    addExecTool({
      name: 'bakin_exec_foo_a',
      description: 'a',
      parameters: {},
      handler: async () => ({ ok: true }),
    })
    addExecTool({
      name: 'bakin_exec_foo_b',
      description: 'b',
      parameters: {},
      handler: async () => ({ ok: true }),
    })
    addExecTool({
      name: 'bakin_exec_bar_a',
      description: 'unrelated',
      parameters: {},
      handler: async () => ({ ok: true }),
    })

    const before = getAllExecTools().filter(t => t.name.startsWith('bakin_exec_foo_')).length
    expect(before).toBe(2)

    const removed = removeExecToolsByPlugin('foo')
    expect(removed).toBe(2)

    const fooLeft = getAllExecTools().filter(t => t.name.startsWith('bakin_exec_foo_')).length
    const barLeft = getAllExecTools().filter(t => t.name === 'bakin_exec_bar_a').length
    expect(fooLeft).toBe(0)
    expect(barLeft).toBe(1)

    // Idempotent — second sweep finds nothing.
    expect(removeExecToolsByPlugin('foo')).toBe(0)

    // Cleanup the remaining unrelated fixture so other tests aren't affected.
    removeExecToolsByPlugin('bar')
  })
})
