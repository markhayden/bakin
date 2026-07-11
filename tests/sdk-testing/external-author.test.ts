/**
 * R16 acceptance: a plugin test written the way an EXTERNAL author would
 * write it — imports only `@makinbakin/sdk` surfaces (never `@bakin/*`,
 * never repo source paths), no content-dir mocks, no `vi` global.
 *
 * No CLAUDE.md mock boilerplate is needed here BY DESIGN: the harness roots
 * `ctx.storage` in its own temp directory and touches no global registries,
 * so there is no `~/.bakin` / `~/.openclaw` leak surface. That isolation is
 * itself under test (see the storage round-trip + dir assertions).
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { definePlugin, defineRoute } from '@makinbakin/sdk'
import type { PluginContext } from '@makinbakin/sdk/types'
import { z } from 'zod'
import {
  activatePlugin,
  callRoute,
  callTool,
  findRoute,
  findTool,
  type PluginTestContext,
} from '@makinbakin/sdk/testing'

// An inline plugin mirroring the scaffold template's shape: one declarative
// route reading plugin storage, one exec tool writing it, settings-aware.
const plugin = definePlugin({
  id: 'demo-crm',
  name: 'demo-crm',
  version: '0.1.0',
  routes: [
    defineRoute({
      method: 'GET',
      path: '/hello',
      summary: 'Return the saved greeting',
      handler: async (_req, ctx) => {
        const saved = ctx.storage.read('last-greeting.txt')
        const { fallback } = ctx.getSettings<{ fallback?: string }>()
        return Response.json({ message: saved ?? fallback ?? 'Hello!' })
      },
    }),
  ],
  async activate(ctx: PluginContext) {
    ctx.registerExecTool({
      name: 'bakin_exec_demo-crm_greet',
      description: 'Builds a greeting and persists it to plugin storage.',
      parameters: { name: z.string().optional() },
      handler: async (params, _agent, toolCtx) => {
        const message = `Hello from ${typeof params.name === 'string' ? params.name : 'demo-crm'}!`
        toolCtx?.storage.write('last-greeting.txt', message)
        return { ok: true, message }
      },
    })
  },
})

describe('@makinbakin/sdk/testing external-author flow', () => {
  let harness: PluginTestContext

  afterAll(() => harness?.dispose())

  it('activates the plugin and captures routes + tools', async () => {
    harness = await activatePlugin(plugin, { settings: { fallback: 'Howdy!' } })
    expect(findRoute(harness.routes, 'GET', '/hello')).toBeDefined()
    expect(findTool(harness.execTools, 'bakin_exec_demo-crm_greet')).toBeDefined()
  })

  it('reads settings through the route before any tool ran', async () => {
    const route = findRoute(harness.routes, 'GET', '/hello')!
    const { status, body } = await callRoute(route, harness.ctx)
    expect(status).toBe(200)
    expect(body.message).toBe('Howdy!')
  })

  it('exec tool writes storage; route reads it back (round-trip)', async () => {
    const tool = findTool(harness.execTools, 'bakin_exec_demo-crm_greet')!
    const result = await callTool(tool, { name: 'Ada' }, 'test-agent', harness.toolContext())
    expect(result).toEqual({ ok: true, message: 'Hello from Ada!' })

    const route = findRoute(harness.routes, 'GET', '/hello')!
    const { body } = await callRoute(route, harness.ctx)
    expect(body.message).toBe('Hello from Ada!')
  })

  it('storage lives under the harness temp dir, not the real home', () => {
    expect(harness.dir).toContain('bakin-demo-crm-test-')
    expect(harness.ctx.storage.exists('last-greeting.txt')).toBe(true)
  })

  it('dispose removes the temp dir', async () => {
    const scratch = await activatePlugin(plugin)
    const { existsSync } = await import('node:fs')
    expect(existsSync(scratch.dir)).toBe(true)
    scratch.dispose()
    expect(existsSync(scratch.dir)).toBe(false)
  })

  it('callTool zod-rejects params production would reject (validation parity)', async () => {
    const tool = findTool(harness.execTools, 'bakin_exec_demo-crm_greet')!
    const result = await callTool(tool, { name: 42 }, 'test-agent', harness.toolContext())
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('invalid parameters')
  })

  it('activatePlugin disposes its temp dir when activate() throws', async () => {
    const { readdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const before = readdirSync(tmpdir()).filter((d) => d.startsWith('bakin-exploding-test-')).length
    const exploding = definePlugin({
      id: 'exploding',
      name: 'exploding',
      version: '0.0.1',
      async activate() {
        throw new Error('boom during activate')
      },
    })
    await expect(activatePlugin(exploding)).rejects.toThrow('boom during activate')
    const after = readdirSync(tmpdir()).filter((d) => d.startsWith('bakin-exploding-test-')).length
    expect(after).toBe(before)
  })
})
