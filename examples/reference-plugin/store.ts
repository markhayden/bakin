/**
 * Storage layer — plain functions over the plugin's scoped StorageAdapter.
 *
 * `ctx.storage` is jailed to this plugin's own data directory
 * (`~/.bakin/plugin-data/reference-bookmarks/`), so paths here are relative
 * and collision-free. Taking the adapter as an argument (instead of closing
 * over ctx) keeps every function unit-testable without a host.
 */
import type { StorageAdapter } from '@makinbakin/sdk/types'
import type { Bookmark } from './types'

const FILE = 'bookmarks.json'

export function loadBookmarks(storage: StorageAdapter): Bookmark[] {
  // readJson returns null when the file doesn't exist yet — treat first
  // run and empty store identically.
  return storage.readJson<Bookmark[]>(FILE) ?? []
}

export function saveBookmarks(storage: StorageAdapter, bookmarks: Bookmark[]): void {
  storage.writeJson(FILE, bookmarks)
}

export interface NewBookmark {
  url: string
  title: string
  tags?: string[]
  note?: string
}

/**
 * Insert a bookmark. `defaultTag` (from plugin settings) applies when the
 * caller supplied no tags; `maxBookmarks` (also settings) is enforced here so
 * the route and the exec tool cannot drift apart on the rule.
 */
export function addBookmark(
  storage: StorageAdapter,
  input: NewBookmark,
  opts: { maxBookmarks: number; defaultTag: string },
): { ok: true; bookmark: Bookmark } | { ok: false; error: string } {
  const bookmarks = loadBookmarks(storage)
  if (bookmarks.length >= opts.maxBookmarks) {
    return { ok: false, error: `bookmark limit reached (${opts.maxBookmarks}) — raise it in this plugin's settings` }
  }
  const tags = input.tags?.length ? input.tags : opts.defaultTag ? [opts.defaultTag] : []
  const bookmark: Bookmark = {
    id: crypto.randomUUID().slice(0, 8),
    url: input.url,
    title: input.title,
    tags,
    ...(input.note ? { note: input.note } : {}),
    createdAt: new Date().toISOString(),
  }
  saveBookmarks(storage, [...bookmarks, bookmark])
  return { ok: true, bookmark }
}

export function removeBookmark(storage: StorageAdapter, id: string): boolean {
  const bookmarks = loadBookmarks(storage)
  const next = bookmarks.filter((b) => b.id !== id)
  if (next.length === bookmarks.length) return false
  saveBookmarks(storage, next)
  return true
}

/** The search document for one bookmark — one place, so index and reindex agree. */
export function bookmarkSearchDoc(b: Bookmark): Record<string, unknown> {
  return {
    title: b.title,
    url: b.url,
    note: b.note ?? '',
    tags: b.tags,
    created_at: b.createdAt,
  }
}
