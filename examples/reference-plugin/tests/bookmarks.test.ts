/**
 * Reference-plugin tests — written the way an EXTERNAL author writes them:
 * imports only from `@makinbakin/sdk/testing` + bun:test + the plugin's own
 * source. `activatePlugin` builds an isolated harness (temp-dir storage, no
 * host, no ~/.bakin); `callRoute`/`callTool` drive the real dispatch shapes.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { activatePlugin, callRoute, callTool, findRoute, findTool } from '@makinbakin/sdk/testing'
import plugin from '../index'

describe('reference-bookmarks', () => {
  const ready = activatePlugin(plugin)
  afterAll(async () => (await ready).dispose())

  it('activates with every declared surface', async () => {
    const h = await ready
    expect(findRoute(h.routes, 'GET', '/')).toBeDefined()
    expect(findRoute(h.routes, 'POST', '/')).toBeDefined()
    expect(findRoute(h.routes, 'DELETE', '/:id')).toBeDefined()
    // Registering a search content type auto-wires GET /search.
    expect(findRoute(h.routes, 'GET', '/search')).toBeDefined()
    expect(findTool(h.execTools, 'bakin_exec_reference-bookmarks_save')).toBeDefined()
    expect(h.healthChecks.some((c) => c.id === 'store-integrity')).toBe(true)
  })

  it('creates, lists, filters, and deletes through the routes', async () => {
    const h = await ready
    const post = findRoute(h.routes, 'POST', '/')!
    const get = findRoute(h.routes, 'GET', '/')!
    const del = findRoute(h.routes, 'DELETE', '/:id')!

    const created = await callRoute(post, h.ctx, {
      body: { url: 'https://bun.sh/docs', title: 'Bun docs', tags: ['docs'] },
    })
    expect(created.status).toBe(201)
    const { id } = (created.body as { bookmark: { id: string } }).bookmark

    const listed = await callRoute(get, h.ctx)
    expect(listed.body.bookmarks).toHaveLength(1)

    const filtered = await callRoute(get, h.ctx, { searchParams: { tag: 'nope' } })
    expect(filtered.body.bookmarks).toHaveLength(0)

    const removed = await callRoute(del, h.ctx, { path: `/${id}` })
    expect(removed.status).toBe(200)
    expect((await callRoute(get, h.ctx)).body.bookmarks).toHaveLength(0)
  })

  it('exec tool and route share one creation path (visible cross-surface)', async () => {
    const h = await ready
    const tool = findTool(h.execTools, 'bakin_exec_reference-bookmarks_save')!
    // Tools that use their third argument (storage/settings/search) need the
    // harness tool context — same shape the host passes in production.
    const result = await callTool(tool, { url: 'https://example.com', title: 'Example' }, 'test-agent', h.toolContext())
    expect(result).toMatchObject({ ok: true })

    const get = findRoute(h.routes, 'GET', '/')!
    const listed = await callRoute(get, h.ctx)
    const { bookmarks } = listed.body as { bookmarks: Array<{ title: string }> }
    expect(bookmarks.map((b) => b.title)).toContain('Example')

    // Mutations emit the SSE change event agents and pages both rely on.
    // (The harness EventBus is real — subscribe and re-run a mutation.
    // Server-side handlers receive `(event, data)`.)
    let seen: unknown = null
    h.ctx.events.on('reference-bookmarks.changed', (_event: string, data: unknown) => { seen = data })
    await callTool(tool, { url: 'https://example.org', title: 'Example 2' }, 'test-agent', h.toolContext())
    expect(seen).toMatchObject({ action: 'created' })
  })

  it('enforces the maxBookmarks setting', async () => {
    const h = await activatePlugin(plugin, { settings: { maxBookmarks: 1 } })
    try {
      const post = findRoute(h.routes, 'POST', '/')!
      const first = await callRoute(post, h.ctx, {
        body: { url: 'https://a.example', title: 'A' },
      })
      expect(first.status).toBe(201)
      const second = await callRoute(post, h.ctx, {
        body: { url: 'https://b.example', title: 'B' },
      })
      expect(second.status).toBe(400)
      expect(String(second.body.error)).toContain('limit')
    } finally {
      h.dispose()
    }
  })

  it('applies the defaultTag setting when no tags are given', async () => {
    const h = await activatePlugin(plugin, { settings: { defaultTag: 'inbox' } })
    try {
      const post = findRoute(h.routes, 'POST', '/')!
      const created = await callRoute(post, h.ctx, {
        body: { url: 'https://c.example', title: 'C' },
      })
      expect((created.body as { bookmark: { tags: string[] } }).bookmark.tags).toEqual(['inbox'])
    } finally {
      h.dispose()
    }
  })

  it('health check reports the store state', async () => {
    const h = await ready
    const check = h.healthChecks.find((c) => c.id === 'store-integrity')!
    const result = await check.run()
    expect(result).toMatchObject({
      outcome: 'observed',
      observations: [{ key: 'capacity', status: 'healthy' }],
    })
  })
})
