/**
 * The bookmarks page — demonstrates the client-side SDK working set:
 *
 *  - `usePluginJsonFetch` for route data with {data, loading, error, refresh}
 *  - `usePluginEvent` for live SSE refresh (server emits on every mutation)
 *  - `pluginFetch` for mutations (no hand-built /api/plugins/... strings)
 *  - `PluginHeader` / `EmptyState` shared components
 *  - `TurnOutputView` — the canonical renderer for agent turn output; shown
 *    here replaying a static chunk sequence so authors see the shape agents
 *    produce when they call this plugin's exec tool.
 */
import { useState } from 'react'
import { PluginHeader, EmptyState, TurnOutputView } from '@makinbakin/sdk/components'
import { usePluginEvent, usePluginJsonFetch } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'
import type { RuntimeChatChunk } from '@makinbakin/sdk/types'
import type { Bookmark } from '../types'

const PLUGIN_ID = 'reference-bookmarks'

/** What a real agent turn looks like when it saves a bookmark — static
 * replay for demonstration; live surfaces feed TurnOutputView the same
 * chunk shapes from streaming. */
const DEMO_TURN: RuntimeChatChunk[] = [
  { type: 'status', content: 'thinking' },
  {
    type: 'tool',
    data: {
      callId: 'demo-1',
      toolName: 'bakin_exec_reference-bookmarks_save',
      phase: 'result',
      status: 'completed',
      summary: 'saved "Bun docs" (bun.sh)',
    },
  },
  { type: 'text', content: 'Saved **Bun docs** to your bookmarks under `docs`.' },
  { type: 'done' },
]

export function BookmarksPage() {
  const { data, loading, refresh } = usePluginJsonFetch<{ bookmarks: Bookmark[] }>(PLUGIN_ID, '/')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The server emits this on every create/delete (including agent-driven
  // ones through the exec tool) — the page stays live without polling.
  usePluginEvent(`${PLUGIN_ID}.changed`, () => refresh())

  async function add() {
    setError(null)
    const res = await pluginFetch(PLUGIN_ID, '/', { method: 'POST', body: { url, title } })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `save failed (${res.status})`)
      return
    }
    setUrl('')
    setTitle('')
    // No manual refresh needed — the .changed event round-trips via SSE.
  }

  async function remove(id: string) {
    await pluginFetch(PLUGIN_ID, `/${id}`, { method: 'DELETE' })
  }

  const bookmarks = data?.bookmarks ?? []

  return (
    <div className="p-6 space-y-6">
      <PluginHeader title="Bookmarks" count={bookmarks.length} />

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          disabled={!url || !title}
          onClick={() => void add()}
        >
          Save
        </button>
      </div>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {loading && bookmarks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : bookmarks.length === 0 ? (
        <EmptyState title="No bookmarks yet" description="Save one above, or ask an agent to." />
      ) : (
        <ul className="space-y-2">
          {bookmarks.map((b: Bookmark) => (
            <li key={b.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0 flex-1">
                <a href={b.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">
                  {b.title}
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {b.url}
                  {b.tags.length > 0 ? ` · ${b.tags.join(', ')}` : ''}
                </p>
              </div>
              <button
                className="text-xs text-muted-foreground hover:text-red-500"
                onClick={() => void remove(b.id)}
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          What agents see — a saved-bookmark turn rendered with TurnOutputView
        </summary>
        <div className="pt-3">
          <TurnOutputView chunks={DEMO_TURN} />
        </div>
      </details>
    </div>
  )
}
