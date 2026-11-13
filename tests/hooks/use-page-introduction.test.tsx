/** A page's first-visit introduction (home-first-run plan, task 7.1): asked for once, shared by every page, closed for good. */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { actRender } from '../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-page-introduction-${crypto.randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { emitPluginEvent } from '../../packages/sdk/src/hooks/use-plugin-event'
import { resetPageIntroductionsForTests, usePageIntroduction } from '../../packages/sdk/src/hooks/use-page-introduction'

const INTRODUCTIONS = [
  { id: 'chat', title: 'This is where you talk to your agents', body: 'Pick an agent and ask.' },
  { id: 'tasks', title: 'This is the board', body: 'Work lives here as tasks.' },
]
let listing: { status: number; body: unknown } = { status: 200, body: { ok: true, introductions: INTRODUCTIONS } }
const requests: Array<{ url: string; method: string }> = []
const realFetch = globalThis.fetch
beforeEach(() => {
  resetPageIntroductionsForTests()
  listing = { status: 200, body: { ok: true, introductions: INTRODUCTIONS } }
  requests.length = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    requests.push({ url, method })
    if (method === 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response(JSON.stringify(listing.body), { status: listing.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
})
afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
})

const mount = (pageId: string) => actRender(() => renderHook(() => usePageIntroduction(pageId)))
const listed = () => requests.filter((request) => request.method === 'GET')

describe('usePageIntroduction', () => {
  it('gives the page its introduction, and nothing before the answer arrives', async () => {
    const page = await mount('tasks')
    await waitFor(() => expect(page.result.current.introduction).toEqual({ title: 'This is the board', body: 'Work lives here as tasks.' }))
  })

  it('a page without one, and a home that offers none, get null', async () => {
    const page = await mount('spend')
    await waitFor(() => expect(listed()).toHaveLength(1))
    expect(page.result.current.introduction).toBeNull()
  })

  it('asks once for every page, however many pages are opened', async () => {
    const chat = await mount('chat')
    await waitFor(() => expect(chat.result.current.introduction).not.toBeNull())
    const tasks = await mount('tasks')
    expect(tasks.result.current.introduction?.title).toBe('This is the board')
    expect(listed()).toHaveLength(1)
  })

  it('closing hides it at once and tells the server; the other pages keep theirs', async () => {
    const chat = await mount('chat')
    const tasks = await mount('tasks')
    await waitFor(() => expect(chat.result.current.introduction).not.toBeNull())
    await act(async () => { chat.result.current.close() })
    expect(chat.result.current.introduction).toBeNull()
    expect(tasks.result.current.introduction).not.toBeNull()
    expect(requests.at(-1)).toEqual({ url: '/api/plugins/home/page-introductions/chat/close', method: 'POST' })
  })

  it('closed in another browser, it goes away here too', async () => {
    const tasks = await mount('tasks')
    await waitFor(() => expect(tasks.result.current.introduction).not.toBeNull())
    await act(async () => { emitPluginEvent({ event: 'home.page_introduction_closed', id: 'tasks' }) })
    expect(tasks.result.current.introduction).toBeNull()
  })

  it('a server that cannot answer shows nothing, and the next page asks again', async () => {
    listing = { status: 500, body: { ok: false } }
    const chat = await mount('chat')
    await waitFor(() => expect(listed()).toHaveLength(1))
    expect(chat.result.current.introduction).toBeNull()
    listing = { status: 200, body: { ok: true, introductions: INTRODUCTIONS } }
    const tasks = await mount('tasks')
    await waitFor(() => expect(tasks.result.current.introduction).not.toBeNull())
    expect(listed()).toHaveLength(2)
  })
})
