import { describe, expect, it, mock, afterEach } from 'bun:test'

import { pluginApiUrl, pluginFetch } from '@makinbakin/sdk/utils'

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
