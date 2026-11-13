// @vitest-environment jsdom
/**
 * The shared terminal handoff (home-first-run plan, task 3.1): whether a
 * browser terminal is available is asked once while the answer is yes, and
 * asked again on the way back to the page while it is not, so a Terminal
 * plugin installed with the page open is found without a reload. Opening
 * prefills the command and never runs it.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-terminal-handoff-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

const routerPush = mock()
mock.module('@makinbakin/sdk/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: mock(), back: mock(), forward: mock(), prefetch: mock(), refresh: mock() }),
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { actRender } from '../rtl-settle'
import { resetTerminalHandoffForTests, useTerminalHandoff } from '../../packages/sdk/src/hooks/use-terminal-handoff'

let plugins: Array<{ id: string; status: 'active' | 'failed' }> = []
let manifestReads = 0
let manifestFails = false
const posts: Array<{ url: string; body: Record<string, unknown> }> = []
let sessionRefused = false
const originalFetch = globalThis.fetch

beforeEach(() => {
  plugins = []
  manifestReads = 0
  manifestFails = false
  sessionRefused = false
  posts.length = 0
  routerPush.mockClear()
  resetTerminalHandoffForTests()
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/plugins/manifest') {
      manifestReads += 1
      if (manifestFails) throw new Error('offline')
      return Response.json({ plugins })
    }
    if (url === '/api/plugins/terminal/options') return Response.json({ defaults: { cwd: '/Users/someone' } })
    posts.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    if (url === '/api/plugins/terminal/sessions') {
      return sessionRefused ? Response.json({ error: 'too many sessions' }, { status: 409 }) : Response.json({ id: 's1', generation: 3, inputSequence: 7 })
    }
    return Response.json({ ok: true })
  }) as unknown as typeof fetch
})
afterEach(() => { globalThis.fetch = originalFetch })

const focus = async () => { await act(async () => { window.dispatchEvent(new Event('focus')) }) }

describe('useTerminalHandoff: is a terminal available', () => {
  it('asks nothing until a command is being shown', async () => {
    const { result } = await actRender(() => renderHook(() => useTerminalHandoff(false)))
    await focus()
    expect(result.current.available).toBeNull()
    expect(manifestReads).toBe(0)
  })

  it('an active Terminal plugin is available, and the answer is shared: one read however many surfaces ask', async () => {
    plugins = [{ id: 'terminal', status: 'active' }]
    const first = await actRender(() => renderHook(() => useTerminalHandoff(true)))
    const second = await actRender(() => renderHook(() => useTerminalHandoff(true)))
    await waitFor(() => expect(second.result.current.available).toBe(true))
    expect(first.result.current.available).toBe(true)
    await focus()
    expect(manifestReads).toBe(1)
  })

  it('absent, failed, or an unreadable manifest all mean copy-only', async () => {
    for (const setup of [() => { plugins = [] }, () => { plugins = [{ id: 'terminal', status: 'failed' }] }, () => { manifestFails = true }]) {
      resetTerminalHandoffForTests()
      manifestFails = false
      setup()
      const { result, unmount } = await actRender(() => renderHook(() => useTerminalHandoff(true)))
      await waitFor(() => expect(result.current.available).toBe(false))
      unmount()
    }
  })

  it('a plugin installed while the page was open is found on the way back to it', async () => {
    const { result } = await actRender(() => renderHook(() => useTerminalHandoff(true)))
    await waitFor(() => expect(result.current.available).toBe(false))
    plugins = [{ id: 'terminal', status: 'active' }]
    await focus()
    await waitFor(() => expect(result.current.available).toBe(true))
    expect(manifestReads).toBe(2)
    await focus()
    expect(manifestReads).toBe(2) // yes is kept
  })
})

describe('useTerminalHandoff: opening', () => {
  it('starts a session, types the command without running it, and goes there', async () => {
    plugins = [{ id: 'terminal', status: 'active' }]
    const { result } = await actRender(() => renderHook(() => useTerminalHandoff(true)))
    const opened: Array<string | null> = []
    await act(async () => { opened.push(await result.current.open('pi', 'Log in to a provider')) })
    expect(opened).toEqual(['s1'])
    expect(posts).toEqual([
      { url: '/api/plugins/terminal/sessions', body: { title: 'Log in to a provider', cwd: '/Users/someone', program: 'shell' } },
      // No trailing newline: the person presses Enter.
      { url: '/api/plugins/terminal/session', body: { id: 's1', operation: 'write', generation: 3, sequence: 8, data: 'pi' } },
    ])
    expect(routerPush).toHaveBeenCalledWith('/terminal/s1')
    expect(result.current.error).toBeNull()
  })

  it('a refused session opens nothing and says to copy the command instead', async () => {
    sessionRefused = true
    const { result } = await actRender(() => renderHook(() => useTerminalHandoff(true)))
    const opened: Array<string | null> = []
    await act(async () => { opened.push(await result.current.open('pi', 'Log in')) })
    expect(opened).toEqual([null])
    expect(result.current.error).toContain('too many sessions')
    expect(routerPush).not.toHaveBeenCalled()
  })
})
