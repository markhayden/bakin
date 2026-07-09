import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const tempDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-route-audit-'))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => tempDir,
  getBakinPaths: () => ({ root: tempDir }),
}))

mock.module('@/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {},
    tasks: {},
    search: {},
  }),
}))
mock.module('@/core/app-services-store', () => ({
  getAppServices: () => ({
    runtime: {},
    tasks: {},
    search: {},
  }),
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/search-registry', () => ({
  buildSearchAPI: () => ({}),
}))

mock.module('@/lib/storage/markdown-adapter', () => ({
  MarkdownStorageAdapter: class {},
}))

mock.module('@bakin/core/storage/scoped-plugin-storage', () => ({
  ScopedPluginStorageAdapter: class {},
}))

mock.module('@/lib/events/event-bus', () => ({
  BakinEventBus: class {
    constructor(readonly broadcast: unknown) {}
  },
}))

mock.module('@/lib/plugin-context-services', () => ({
  createPluginAssetsAPI: () => ({}),
  createPluginRuntimeFacade: () => ({}),
  createPluginTaskService: () => ({}),
}))

mock.module('@/lib/plugin-permissions', () => ({
  wrapPluginContextPermissions: (ctx: unknown) => ctx,
}))

mock.module('@/core/plugin-host/version-stamp', () => ({
  stampPluginResponse: (_pluginId: string, res: Response) => res,
}))

mock.module('@/core/plugin-registry', () => ({
  pluginRegistry: {
    getPluginState: () => ({
      source: 'user',
      manifest: { permissions: [] },
      routes: [
        {
          path: '/do',
          method: 'POST',
          handler: async (_req: Request, ctx: any) => {
            ctx.activity.audit('route_event', 'route-agent', { custom: 'field' })
            return Response.json({ ok: true })
          },
        },
      ],
    }),
  },
}))

import { post } from '../../packages/host/src/api/plugins/[pluginId]/[[...path]]'

describe('plugin route audit context', () => {
  afterEach(() => {
    delete (globalThis as any).__bakinBroadcast
    delete (globalThis as any).__bakinBroadcastAudit
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes request-time ctx.activity.audit entries with the canonical audit shape', async () => {
    const broadcastAudit = mock()
    ;(globalThis as any).__bakinBroadcastAudit = broadcastAudit

    const req = new Request('http://localhost/api/plugins/audit-plugin/do', {
      method: 'POST',
      headers: { 'x-bakin-agent': 'patch' },
    })

    const res = await post(req, new URL(req.url))

    expect(res.status).toBe(200)
    const entries = readFileSync(join(tempDir, 'audit.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    const entry = entries.find(item => item.event === 'audit-plugin.route_event')

    expect(entry).toMatchObject({
      event: 'audit-plugin.route_event',
      agent: 'route-agent',
      channel: 'rest',
      data: { custom: 'field' },
    })
    expect(entry.custom).toBeUndefined()
    expect(broadcastAudit).toHaveBeenCalledWith(expect.objectContaining({
      event: 'audit-plugin.route_event',
      data: { custom: 'field' },
    }))
  })
})
