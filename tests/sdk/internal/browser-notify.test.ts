/**
 * Navigate bridge for OS-notification clicks (routing overhaul PR1).
 *
 * The bridge is globalThis-based on purpose (see the module header of
 * packages/sdk/src/internal/browser-notify.ts). These tests pin the
 * contract: registered bridge wins, missing bridge falls back to a hard
 * navigation.
 */
import { describe, test, expect, afterEach, mock, spyOn } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

// browser-notify is a pure client lib (no storage), but the content-dir
// resolvers are mocked defensively per the repo-wide test isolation rule.
const testDir = join(tmpdir(), `bakin-test-browser-notify-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))

import { setNotificationNavigator, navigateToUrl } from '../../../packages/sdk/src/internal/browser-notify'

const globalBridge = globalThis as { __bakinNavigate?: (url: string) => void }

afterEach(() => {
  delete globalBridge.__bakinNavigate
})

describe('navigate bridge', () => {
  test('setNotificationNavigator registers the globalThis bridge', () => {
    const seen: string[] = []
    setNotificationNavigator((url) => seen.push(url))
    expect(typeof globalBridge.__bakinNavigate).toBe('function')

    navigateToUrl('/tasks?taskId=abc')
    expect(seen).toEqual(['/tasks?taskId=abc'])
  })

  test('bridge registered by another module copy is still used', () => {
    // Simulates a registration that reached globalThis without going through
    // this module instance (a re-evaluated copy) — the bridge is read from
    // globalThis, never from module state.
    const seen: string[] = []
    globalBridge.__bakinNavigate = (url) => seen.push(url)

    navigateToUrl('/chat/abc')
    expect(seen).toEqual(['/chat/abc'])
  })

  test('falls back to a hard navigation when no bridge is registered', () => {
    expect(globalBridge.__bakinNavigate).toBeUndefined()
    const assign = spyOn(window.location, 'assign').mockImplementation(() => {})
    try {
      navigateToUrl('/health')
      expect(assign).toHaveBeenCalledWith('/health')
    } finally {
      assign.mockRestore()
    }
  })
})
