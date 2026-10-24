/**
 * ctx.operations through the published harness (#895 D19), written the way an
 * external author would: only `@makinbakin/sdk` imports, no content-dir mocks.
 * The harness runs a real registry with the host's rules and in-memory
 * resources, so nothing touches a real Bakin home.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { definePlugin, defineRoute } from '@makinbakin/sdk'
import type { OperationPlan } from '@makinbakin/sdk/types'
import { activatePlugin, callRoute, createTestContext, findRoute } from '@makinbakin/sdk/testing'

const PLAN: OperationPlan = {
  stages: [
    { id: 'download', kind: 'downloading', label: 'Download voices' },
    { id: 'install', kind: 'installing', label: 'Install voices' },
  ],
  pointOfNoReturn: 'install',
}

const plugin = definePlugin({
  id: 'voice-pack',
  name: 'voice-pack',
  version: '0.1.0',
  activate: () => {},
  routes: [
    defineRoute({
      method: 'POST',
      path: '/install',
      summary: 'Install voices in the background',
      handler: async (req, ctx) => {
        const started = await ctx.operations.start({
          kind: 'install',
          title: 'Install voices',
          fingerprint: 'voices',
          resources: ['voice-pack:voices'],
          plan: PLAN,
          request: req,
          run: async (op) => {
            op.stage('download')
            op.item('download', { id: 'en', label: 'English', status: 'active' })
            op.bytes('download', { received: 512, total: 1024 }, 'en')
            op.item('download', { id: 'en', label: 'English', status: 'done' })
            op.stage('install')
            return { status: 'succeeded', code: 'ok', httpStatus: 200, body: { installed: ['en'] } }
          },
        })
        return Response.json(started, { status: started.attached ? 200 : 202 })
      },
    }),
  ],
})

const harness = await activatePlugin(plugin)
afterAll(() => harness.dispose())

describe('ctx.operations in the testing harness', () => {
  it('answers 202 and runs the operation to its outcome', async () => {
    const route = findRoute(harness.routes, 'POST', '/install')!
    const { status, body } = await callRoute(route, harness.ctx)
    expect(status).toBe(202)
    const { operationId } = body as { operationId: string }

    const view = await harness.ctx.operations.await(operationId)
    expect(view.kind).toBe('voice-pack:install')
    expect(view.owner).toBe('plugin:voice-pack')
    expect(view.origin).toBe('web')
    expect(view.status).toBe('succeeded')
    expect(view.result).toEqual({ httpStatus: 200, body: { installed: ['en'] } })
    expect(view.stages.map((s) => s.status)).toEqual(['done', 'done'])
    expect(view.stages[0].items).toEqual([{ id: 'en', label: 'English', status: 'done', bytes: { received: 512, total: 1024 } }])
  })

  it('refuses core resources for a user plugin', async () => {
    const t = createTestContext('voice-pack')
    await expect(t.ctx.operations.start({
      kind: 'x', title: 'X', fingerprint: 'x', plan: PLAN, resources: ['media-store'],
      run: async () => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: null }),
    })).rejects.toThrow(/reserved for core plugins/)
    t.dispose()
  })

  it('makes a second operation wait on a held plugin resource, then run', async () => {
    const t = createTestContext('voice-pack')
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const first = await t.ctx.operations.start({
      kind: 'a', title: 'First', fingerprint: 'a', plan: PLAN, resources: ['voice-pack:voices'],
      run: async () => { await gate; return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null } },
    })
    const second = await t.ctx.operations.start({
      kind: 'b', title: 'Second', fingerprint: 'b', plan: PLAN, resources: ['voice-pack:voices'],
      run: async () => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: 'second' }),
    })
    release()
    expect((await t.ctx.operations.await(first.operationId)).status).toBe('succeeded')
    const view = await t.ctx.operations.await(second.operationId)
    expect(view.result?.body).toBe('second')
    expect(view.log.some((l) => l.text.startsWith('Waiting for First'))).toBe(true)
    t.dispose()
  })
})

describe('applyHealthRepair', () => {
  it('runs a repair action inside a real operation built from its declared plan', async () => {
    const harness = createTestContext('cache-tools')
    afterAll(() => harness.dispose())
    harness.ctx.registerHealthRepairAction({
      id: 'clear-cache',
      name: 'Clear the cache',
      effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
      resources: ['cache-tools:cache'],
      plan: async () => [],
      operationPlan: () => ({
        stages: [
          { id: 'scan', kind: 'preparing', label: 'Find stale entries' },
          { id: 'clear', kind: 'cleanup', label: 'Remove stale entries' },
        ],
        pointOfNoReturn: 'clear',
      }),
      apply: async (items, op) => {
        op?.stage('scan')
        op?.item('scan', { id: 'a', label: 'entry a', status: 'done' })
        op?.stage('clear')
        return items.map((item) => ({ itemId: item.id, actionId: 'clear-cache', status: 'applied' as const, message: 'cleared', affectedCheckIds: [], changes: [] }))
      },
    })
    const item = { id: 'i1', actionId: 'clear-cache' } as never
    const { results, operation } = await harness.applyHealthRepair('clear-cache', [item])
    expect(results.map((r) => r.status)).toEqual(['applied'])
    expect(operation.status).toBe('succeeded')
    expect(operation.resources).toEqual(['cache-tools:cache'])
    expect(operation.stages.map((s) => s.status)).toEqual(['done', 'done'])
    expect(operation.stages[0]!.items?.map((i) => i.label)).toEqual(['entry a'])
  })

  it('refuses a core resource for a user plugin, as the host does', async () => {
    const harness = createTestContext('cache-tools')
    afterAll(() => harness.dispose())
    harness.ctx.registerHealthRepairAction({ id: 'x', name: 'X', effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false }, resources: ['media-store'], operationPlan: () => ({ stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' }), plan: async () => [], apply: async () => [] })
    await expect(harness.applyHealthRepair('x', [])).rejects.toThrow('media-store')
  })
})
