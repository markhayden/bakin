import { usePluginEvent, usePluginJsonFetch } from '@makinbakin/sdk/hooks'
import type { Bookmark } from '../types'

export const PLUGIN_ID = 'reference-bookmarks'

/** Keep every plugin-owned bookmark surface live through the shared shell event stream. */
export function useBookmarks() {
  const result = usePluginJsonFetch<{ bookmarks: Bookmark[] }>(PLUGIN_ID, '/')
  usePluginEvent(`${PLUGIN_ID}.changed`, result.refresh)
  return result
}
