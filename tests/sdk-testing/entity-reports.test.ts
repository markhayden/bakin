/**
 * Entity reporting through the published harness, written the way an external
 * author would: only `@makinbakin/sdk` imports. A tool that reports a kind its
 * manifest entry does not list fails here, in the author's own tests, instead
 * of silently producing no card in production.
 */
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { definePlugin, type PluginContext } from '@makinbakin/sdk'
import { activatePlugin, callTool, findTool } from '@makinbakin/sdk/testing'

const manifest = (reports?: string[]) => ({
  id: 'notes',
  name: 'Notes',
  version: '0.1.0',
  bakin: '*',
  description: 'Notes',
  contributes: {
    entities: [{ kind: 'note', label: 'Note', icon: 'StickyNote', href: '/notes/{id}' }],
    execTools: [{ name: 'bakin_exec_notes_create', summary: 'Create a note', ...(reports ? { reports } : {}) }],
  },
})

const plugin = definePlugin({
  id: 'notes',
  name: 'Notes',
  version: '0.1.0',
  activate: (ctx: PluginContext) => {
    ctx.registerExecTool({
      name: 'bakin_exec_notes_create',
      description: 'Create a note',
      parameters: { title: z.string() },
      handler: async ({ title }) => ({
        ok: true,
        id: 'n-1',
        entities: [{ kind: 'notes:note', id: 'n-1', title, action: 'created' as const }],
      }),
    })
  },
})

describe('entity reporting in the SDK harness', () => {
  it('a declared kind passes and stays on the result for assertions', async () => {
    const harness = await activatePlugin(plugin, { manifest: manifest(['notes:note']) })
    const result = await callTool(findTool(harness.execTools, 'bakin_exec_notes_create')!, { title: 'Groceries' })
    expect(result.entities).toEqual([{ kind: 'notes:note', id: 'n-1', title: 'Groceries', action: 'created' }])
    harness.dispose()
  })

  it('reporting a kind the manifest entry does not list fails the call', async () => {
    const harness = await activatePlugin(plugin, { manifest: manifest() })
    await expect(callTool(findTool(harness.execTools, 'bakin_exec_notes_create')!, { title: 'Groceries' }))
      .rejects.toThrow(/bakin_exec_notes_create reported "notes:note".*contributes\.execTools\[\]\.reports/)
    harness.dispose()
  })

  it('reporting without a manifest fails with what to pass', async () => {
    const harness = await activatePlugin(plugin)
    await expect(callTool(findTool(harness.execTools, 'bakin_exec_notes_create')!, { title: 'Groceries' }))
      .rejects.toThrow(/pass \{ manifest \}/)
    harness.dispose()
  })

  it('an invalid manifest fails activation the way install does', async () => {
    await expect(activatePlugin(plugin, { manifest: manifest(['notes:missing']) }))
      .rejects.toThrow(/not declared in contributes\.entities/)
  })
})
