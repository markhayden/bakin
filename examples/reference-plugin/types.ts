/** One saved bookmark. Kept flat — the whole list serializes to storage. */
export interface Bookmark {
  id: string
  url: string
  title: string
  tags: string[]
  note?: string
  createdAt: string
}

/** Payload of the `reference-bookmarks.changed` SSE event. */
export interface BookmarksChangedEvent {
  action: 'created' | 'deleted'
  id: string
}
