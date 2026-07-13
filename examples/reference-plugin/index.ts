/**
 * Bookmarks — the Bakin reference plugin, server entry.
 *
 * This is the canonical template for external plugin authors: every server
 * surface a plugin can contribute is exercised here with the smallest honest
 * example. Imports come ONLY from `@makinbakin/sdk/*` — that is the entire
 * public authoring surface; if you find yourself wanting an import from
 * Bakin's internals, there is either an SDK way or a missing feature to
 * report.
 *
 * The declare-twice rule: every HTTP route and exec tool registered in this
 * file is mirrored in bakin-plugin.json's `contributes` — that mirror is what
 * users consent to at install time, and activation fails loudly on drift.
 * `bakin plugins sync-manifest` regenerates the mirror from this code.
 */
import { definePlugin, defineRoute } from '@makinbakin/sdk'
import type { EventBus, PluginContext, SearchAPI, StorageAdapter } from '@makinbakin/sdk/types'
import { healthError, healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import { z } from 'zod'
import {
  addBookmark,
  bookmarkSearchDoc,
  loadBookmarks,
  removeBookmark,
} from './store'

const PLUGIN_ID = 'reference-bookmarks'

/**
 * The slice of context the create path needs. Both `PluginContext` (routes)
 * and `PluginToolContext` (exec tools) satisfy it structurally, so the route
 * and the tool share one code path with no casts.
 */
interface BookmarkServices {
  storage: StorageAdapter
  events: EventBus
  search: SearchAPI
  getSettings<T = Record<string, unknown>>(): T
}

/** Settings shape — mirrors `settingsSchema` below. `ctx.getSettings` returns
 * ONLY what was persisted (`{}` on a fresh install) — schema defaults are NOT
 * applied for you, which is why `settingsOf` re-applies them. Keep that
 * pattern: reading a field without a fallback is `undefined` until the user
 * saves the settings page once. */
interface BookmarkSettings {
  maxBookmarks: number
  defaultTag: string
}

function settingsOf(ctx: BookmarkServices): BookmarkSettings {
  const s = ctx.getSettings<Partial<BookmarkSettings>>()
  return { maxBookmarks: s.maxBookmarks ?? 200, defaultTag: s.defaultTag ?? '' }
}

/**
 * Create a bookmark: one shared path for the POST route AND the exec tool,
 * so humans and agents get identical behavior (limits, defaults, search
 * indexing, change events).
 */
function createBookmark(
  ctx: BookmarkServices,
  input: { url: string; title: string; tags?: string[]; note?: string },
) {
  const result = addBookmark(ctx.storage, input, settingsOf(ctx))
  if (!result.ok) return result
  // Fire-and-forget: search writes journal through the durable outbox — the
  // engine being down means the row waits, never blocks the request. Catch
  // (never `void`): the enqueue itself can reject, and an unhandled
  // rejection is noise the caller can't act on.
  ctx.search.index(result.bookmark.id, bookmarkSearchDoc(result.bookmark)).catch(() => {})
  // SSE to every connected browser; the page subscribes via usePluginEvent.
  ctx.events.emit(`${PLUGIN_ID}.changed`, { action: 'created', id: result.bookmark.id })
  return result
}

const plugin = definePlugin({
  id: PLUGIN_ID,
  name: 'Bookmarks (reference plugin)',
  version: '0.1.0',

  /**
   * Rendered on this plugin's settings page by the host — no UI code needed.
   * Values persist to `~/.bakin/plugin-settings/reference-bookmarks.json`
   * and are read back (with these defaults) via `ctx.getSettings()`.
   */
  settingsSchema: {
    fields: [
      {
        key: 'maxBookmarks',
        type: 'number' as const,
        label: 'Maximum bookmarks',
        description: 'Creation is refused past this limit.',
        default: 200,
      },
      {
        key: 'defaultTag',
        type: 'string' as const,
        label: 'Default tag',
        description: 'Applied to bookmarks saved without tags. Empty = none.',
        default: '',
      },
    ],
  },

  /**
   * Declarative HTTP routes — the modern registration style. Zod schemas on
   * params/query/body give the handler typed `parsed` input AND feed the
   * generated API docs. Paths are namespaced under
   * `/api/plugins/reference-bookmarks/` by the host.
   */
  routes: [
    defineRoute({
      method: 'GET',
      path: '/',
      summary: 'List bookmarks',
      description: 'All bookmarks, optionally filtered by ?tag=.',
      query: z.object({ tag: z.string().optional() }),
      handler: async (_req, ctx, parsed) => {
        const bookmarks = loadBookmarks(ctx.storage)
        const tag = parsed.query.tag
        return Response.json({
          bookmarks: tag ? bookmarks.filter((b) => b.tags.includes(tag)) : bookmarks,
        })
      },
    }),

    defineRoute({
      method: 'POST',
      path: '/',
      summary: 'Create a bookmark',
      description: 'Saves a bookmark, indexes it for search, and emits reference-bookmarks.changed.',
      body: {
        contentType: 'application/json' as const,
        schema: z.object({
          url: z.string().url(),
          title: z.string().min(1),
          tags: z.array(z.string()).optional(),
          note: z.string().optional(),
        }),
      },
      handler: async (_req, ctx, parsed) => {
        const result = createBookmark(ctx, parsed.body)
        if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
        return Response.json({ bookmark: result.bookmark }, { status: 201 })
      },
    }),

    defineRoute({
      method: 'DELETE',
      path: '/:id',
      summary: 'Delete a bookmark',
      description: 'Removes the bookmark and its search document.',
      params: z.object({ id: z.string().min(1) }),
      handler: async (_req, ctx, parsed) => {
        if (!removeBookmark(ctx.storage, parsed.params.id)) {
          return Response.json({ error: 'bookmark not found' }, { status: 404 })
        }
        ctx.search.remove(parsed.params.id).catch(() => {})
        ctx.events.emit(`${PLUGIN_ID}.changed`, { action: 'deleted', id: parsed.params.id })
        return Response.json({ ok: true })
      },
    }),
  ],

  async activate(ctx: PluginContext) {
    /**
     * Exec tool — how AGENTS call into this plugin (over MCP or in-process,
     * depending on the runtime). User-plugin tool names must be prefixed
     * `bakin_exec_<pluginId>_`. Parameters are a zod shape; the handler
     * receives them typed.
     */
    ctx.registerExecTool({
      name: 'bakin_exec_reference-bookmarks_save',
      description: 'Save a bookmark with optional tags and a note.',
      parameters: {
        url: z.string().describe('The URL to bookmark'),
        title: z.string().describe('Short human title'),
        tags: z.array(z.string()).optional().describe('Tags for filtering'),
        note: z.string().optional().describe('Why this is worth keeping'),
      },
      handler: async (params, _agent, toolCtx) => {
        // Exec tools get their own scoped context (storage/settings/search);
        // it satisfies BookmarkServices, so this is the same creation path
        // the POST route uses — agents and humans cannot drift apart.
        if (!toolCtx) return { ok: false, error: 'tool context unavailable' }
        const result = createBookmark(toolCtx, params)
        if (!result.ok) return { ok: false, error: result.error }
        return { ok: true, id: result.bookmark.id, title: result.bookmark.title }
      },
    })

    /**
     * Search: one content type = one logical table, blue/green-versioned by
     * `schemaVersion`. Registering also auto-wires `GET /search` on this
     * plugin (declared in the manifest like any other route) and joins global
     * ⌘K search — the client's hit renderer decides how results look.
     */
    ctx.search.registerContentType({
      table: PLUGIN_ID,
      schemaVersion: 1,
      schema: {
        title: { type: 'text' },
        url: { type: 'keyword' },
        note: { type: 'text' },
        tags: { type: 'array' },
        created_at: { type: 'datetime' },
      },
      searchableFields: ['title', 'note', 'url'],
      // Template fields use DOUBLE braces — `{x}` single braces embed as
      // literal text and silently kill semantic search for the whole type.
      embeddingTemplate: '{{title}}\n{{note}}',
      facets: ['tags'],
      // Reindex is the blue/green rebuild path: yield every live document.
      reindex: async function* () {
        for (const b of loadBookmarks(ctx.storage)) {
          yield { key: b.id, doc: bookmarkSearchDoc(b) }
        }
      },
      verifyExists: async (key) => loadBookmarks(ctx.storage).some((b) => b.id === key),
    })

    /**
     * Health check — surfaces on the health dashboard and `bakin doctor`.
     * Return rows, never throw for "unhealthy": status carries the severity.
     */
    ctx.registerHealthCheck({
      id: 'store-integrity',
      name: 'Bookmark store integrity',
      description: 'Checks that bookmark storage is readable and has capacity for new bookmarks.',
      group: { key: 'reference-bookmarks', label: 'Reference Bookmarks' },
      maxAgeMs: 5 * 60_000,
      run: async () => {
        const { maxBookmarks } = settingsOf(ctx)
        try {
          const count = loadBookmarks(ctx.storage).length
          const nearLimit = count >= maxBookmarks * 0.9
          return healthObserved([nearLimit
            ? healthWarning({
                key: 'capacity',
                summary: `${count}/${maxBookmarks} bookmarks — approaching the configured limit.`,
                evidence: { count, maxBookmarks },
                incident: {
                  key: 'capacity',
                  title: 'Bookmark storage is approaching its limit',
                  impact: 'New bookmarks will be rejected after the configured limit is reached.',
                  disposition: 'advisory',
                  resources: [{ kind: 'plugin', id: PLUGIN_ID, label: 'Reference Bookmarks' }],
                  resolution: { key: 'review-bookmarks', type: 'navigate', label: 'Review bookmarks', href: '/reference-bookmarks' },
                },
              })
            : healthHealthy({
                key: 'capacity',
                summary: `${count} bookmarks stored with capacity remaining.`,
                evidence: { count, maxBookmarks },
              })])
        } catch (err) {
          return healthObserved([healthError({
            key: 'readability',
            summary: `bookmarks.json is unreadable: ${err instanceof Error ? err.message : String(err)}`,
            incident: {
              key: 'readability',
              title: 'Bookmark storage is unreadable',
              impact: 'Bookmarks cannot be listed, created, or removed until storage is restored.',
              disposition: 'action_required',
              resources: [{ kind: 'file', id: 'bookmarks.json', label: 'bookmarks.json' }],
              resolution: {
                key: 'restore-storage',
                type: 'instructions',
                label: 'Restore bookmark storage',
                steps: ['Check the plugin storage directory permissions and repair or restore bookmarks.json, then rerun Health.'],
              },
            },
          })])
        }
      },
    })

    ctx.log.info('reference-bookmarks activated')
  },
})

export default plugin
