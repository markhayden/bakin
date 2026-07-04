/**
 * Tests for the HookRegistry class (packages/core/src/hooks/hook-registry.ts).
 * Split from plugin-registry.test.ts (FW7) — a standalone unit with no app
 * dependencies; the dual content-dir mocks below are pure defense-in-depth
 * (CLAUDE.md testing rules) since nothing here touches the filesystem.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { HookRegistry } from '../../packages/core/src/hooks/hook-registry'

const testDir = join(tmpdir(), `bakin-test-hook-registry-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

describe('HookRegistry', () => {
  let registry: HookRegistry

  beforeEach(() => {
    registry = new HookRegistry()
  })

  it('register() makes has() return true', () => {
    registry.register('test.hook', () => {})
    expect(registry.has('test.hook')).toBe(true)
  })

  it('has() returns false for unregistered hooks', () => {
    expect(registry.has('nonexistent')).toBe(false)
  })

  it('unsubscribe removes handler and has() returns false', () => {
    const unsub = registry.register('test.hook', () => {})
    unsub()
    expect(registry.has('test.hook')).toBe(false)
  })

  it('call() returns original data when no handlers registered', async () => {
    const result = await registry.call('empty', { value: 42 })
    expect(result).toEqual({ value: 42 })
  })

  it('call() chains multiple handlers in waterfall', async () => {
    registry.register('math', (n: number) => n + 1)
    registry.register('math', (n: number) => n * 2)
    const result = await registry.call('math', 5)
    expect(result).toBe(12) // (5 + 1) * 2
  })

  it('call() skips handler result when it returns null or undefined', async () => {
    registry.register('skip', () => null)
    registry.register('skip', (n: number) => n + 10)
    const result = await registry.call('skip', 5)
    expect(result).toBe(15) // null skipped, 5 + 10
  })

  it('callAll() invokes all handlers and ignores return values', async () => {
    const spy1 = mock()
    const spy2 = mock()
    registry.register('notify', spy1)
    registry.register('notify', spy2)
    await registry.callAll('notify', { event: 'ping' })
    expect(spy1).toHaveBeenCalledWith({ event: 'ping' })
    expect(spy2).toHaveBeenCalledWith({ event: 'ping' })
  })

  it('invoke() calls only the first registered handler', async () => {
    const spy1 = mock().mockReturnValue('first')
    const spy2 = mock().mockReturnValue('second')
    registry.register('rpc', spy1)
    registry.register('rpc', spy2)
    const result = await registry.invoke<string>('rpc', 'input')
    expect(result).toBe('first')
    expect(spy1).toHaveBeenCalledWith('input')
    expect(spy2).not.toHaveBeenCalled()
  })

  it('invoke() returns undefined when no handlers exist', async () => {
    const result = await registry.invoke('missing', 'data')
    expect(result).toBeUndefined()
  })

  it('getRegisteredHooks() lists all registered hook names', () => {
    registry.register('alpha', () => {})
    registry.register('beta', () => {})
    const hooks = registry.getRegisteredHooks()
    expect(hooks).toContain('alpha')
    expect(hooks).toContain('beta')
    expect(hooks).toHaveLength(2)
  })
})
