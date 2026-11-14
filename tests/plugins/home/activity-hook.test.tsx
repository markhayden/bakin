/** Home's activity follows changes made elsewhere (home follow-up): the board and finished chat turns. */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { actRender } from '../../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-home-activity-hook-${crypto.randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { emitPluginEvent } from '@makinbakin/sdk/hooks'
import { REFRESH_SETTLE_MS, useHomeActivity } from '../../../plugins/home/lib/client/activity'
import { settleFor } from '../../helpers/wait'

/** How many times the board was read: one per Home activity read. */
let boardReads = 0
let tasks: unknown[] = []
const realFetch = globalThis.fetch
beforeEach(() => {
  boardReads = 0
  tasks = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/plugins/tasks/') {
      boardReads += 1
      return Response.json({ columns: { inProgress: tasks } })
    }
    if (url.startsWith('/api/plugins/chat/chats')) return Response.json({ chats: [] })
    if (url.startsWith('/api/plugins/schedule/occurrences')) return Response.json({ occurrences: [] })
    if (url === '/api/plugins/schedule/') return Response.json({ jobs: [] })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
})
afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
})

const inProgress = (hook: { result: { current: ReturnType<typeof useHomeActivity> } }) => {
  const summary = hook.result.current
  return summary && summary.tasks !== 'unknown' ? summary.tasks.inProgress : null
}

describe('useHomeActivity', () => {
  it('reads once when Home opens', async () => {
    const hook = await actRender(() => renderHook(() => useHomeActivity(true)))
    await waitFor(() => expect(inProgress(hook)).toBe(0))
    expect(boardReads).toBe(1)
  })

  it('follows the board: a task changing anywhere is on Home a moment later', async () => {
    const hook = await actRender(() => renderHook(() => useHomeActivity(true)))
    await waitFor(() => expect(boardReads).toBe(1))
    tasks = [{ id: 't1', title: 'Launch plan', updatedAt: Date.now() }]
    await act(async () => { emitPluginEvent({ event: 'taskboard' }) })
    await waitFor(() => expect(inProgress(hook)).toBe(1), { timeout: REFRESH_SETTLE_MS + 1500 })
    expect(boardReads).toBe(2)
  })

  it('a burst of changes is read once, after the last', async () => {
    const hook = await actRender(() => renderHook(() => useHomeActivity(true)))
    await waitFor(() => expect(boardReads).toBe(1))
    await act(async () => {
      emitPluginEvent({ event: 'taskboard' })
      emitPluginEvent({ event: 'chat.done' })
      emitPluginEvent({ event: 'taskboard' })
    })
    await waitFor(() => expect(boardReads).toBe(2), { timeout: REFRESH_SETTLE_MS + 1500 })
    await act(async () => { await settleFor(REFRESH_SETTLE_MS + 250, 'a second read would land within one settle window') })
    expect(boardReads).toBe(2)
    expect(hook.result.current).not.toBeNull()
  })

  it('reads nothing while it is turned off', async () => {
    await actRender(() => renderHook(() => useHomeActivity(false)))
    await act(async () => { emitPluginEvent({ event: 'taskboard' }) })
    await act(async () => { await settleFor(REFRESH_SETTLE_MS + 250, 'a disabled hook must not read on a change') })
    expect(boardReads).toBe(0)
  })
})
