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
