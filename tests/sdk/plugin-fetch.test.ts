import { describe, expect, it, mock, afterEach } from 'bun:test'

import { pluginFetch, pluginFetchJson } from '@makinbakin/sdk/utils'
import { pluginApiUrl } from '../../packages/sdk/src/utils/plugin-fetch'

const realFetch = globalThis.fetch

afterEach(() => { globalThis.fetch = realFetch })

describe('pluginApiUrl', () => {
  it('builds the canonical plugin route URL', () => {
    expect(pluginApiUrl('chat', 'chats')).toBe('/api/plugins/chat/chats')
    expect(pluginApiUrl('chat', '/chats/abc')).toBe('/api/plugins/chat/chats/abc')
    expect(pluginApiUrl('brands', '/')).toBe('/api/plugins/brands/')
  })
})

describe('pluginFetch', () => {
  it('fetches the normalized URL with Accept: application/json', async () => {
    const spy = mock(async () => new Response('{}'))
    globalThis.fetch = spy as unknown as typeof fetch
    await pluginFetch('chat', 'chats?agent=a')
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/plugins/chat/chats?agent=a')
    expect(new Headers(init.headers).get('Accept')).toBe('application/json')
  })

  it('stringifies plain-object bodies with a JSON content type', async () => {
    const spy = mock(async () => new Response('{}'))
    globalThis.fetch = spy as unknown as typeof fetch
    await pluginFetch('chat', 'chats', { method: 'POST', body: { agentId: 'x' } })
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBe('{"agentId":"x"}')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('passes BodyInit through untouched and keeps caller headers', async () => {
    const spy = mock(async () => new Response('{}'))
    globalThis.fetch = spy as unknown as typeof fetch
    const form = new FormData()
    await pluginFetch('assets', 'upload', { method: 'POST', body: form, headers: { 'X-Custom': '1' } })
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBe(form)
    const headers = new Headers(init.headers)
    expect(headers.get('X-Custom')).toBe('1')
    expect(headers.get('Content-Type')).toBeNull()
  })
})

describe('pluginFetchJson', () => {
  it('parses the JSON body of an ok response', async () => {
    globalThis.fetch = mock(async () => new Response('{"rules":[]}')) as unknown as typeof fetch
    await expect(pluginFetchJson<{ rules: unknown[] }>('spend', 'limits', { timeoutMs: 1000 })).resolves.toEqual({ rules: [] })
  })

  it('names the request in a non-ok failure', async () => {
    globalThis.fetch = mock(async () => new Response('x', { status: 503 })) as unknown as typeof fetch
    await expect(pluginFetchJson('spend', 'limits', { timeoutMs: 1000, label: 'Limits' })).rejects.toThrow('Limits fetch failed (503)')
  })

  it('rejects with a plain timeout error when the deadline passes — even mid-body — and never as an AbortError', async () => {
    // Headers arrive at once; the body never does: racing the bare fetch
    // promise would hang forever here.
    globalThis.fetch = mock(async () => new Response(new ReadableStream({ start() {} }))) as unknown as typeof fetch
    const err = await pluginFetchJson('spend', 'spend', { timeoutMs: 20 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('Error')
    expect((err as Error).message).toBe('Request timed out')
  })

  it("forwards the caller's abort as an AbortError", async () => {
    globalThis.fetch = mock((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })) as unknown as typeof fetch
    const controller = new AbortController()
    const pending = pluginFetchJson('spend', 'spend', { timeoutMs: 5000, signal: controller.signal })
    controller.abort()
    const err = await pending.catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
  })
})
