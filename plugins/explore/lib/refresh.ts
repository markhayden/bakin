/**
 * Remote catalog refresh — explicit user action only, never automatic.
 *
 * Fetches catalog.json from the official bits repo, zod-validates it, and
 * caches it atomically under ~/.bakin/plugin-data/explore/. Every failure
 * mode leaves the existing cache untouched and reports an honest reason.
 */
import { dirname } from 'path'
import { mkdirSync } from 'fs'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { CatalogFileSchema, type CatalogFile } from '../../../src/core/curated-catalog/schema'
import { remoteCachePath } from './catalog'

export const REMOTE_CATALOG_URL =
  'https://raw.githubusercontent.com/markhayden/bakin-bits-official/main/catalog.json'

export type RefreshResult =
  | { ok: true; catalog: CatalogFile }
  | { ok: false; reason: 'no-remote-catalog' | 'network' | 'invalid'; error: string }

export type Fetcher = (url: string) => Promise<Response>

export async function refreshRemoteCatalog(fetcher: Fetcher = fetch): Promise<RefreshResult> {
  let response: Response
  try {
    response = await fetcher(REMOTE_CATALOG_URL)
  } catch (err) {
    return { ok: false, reason: 'network', error: err instanceof Error ? err.message : String(err) }
  }

  if (response.status === 404) {
    return { ok: false, reason: 'no-remote-catalog', error: 'The official bits repo has no catalog.json yet.' }
  }
  if (!response.ok) {
    return { ok: false, reason: 'network', error: `Remote catalog fetch failed with HTTP ${response.status}` }
  }

  let raw: unknown
  try {
    raw = JSON.parse(await response.text())
  } catch (err) {
    return { ok: false, reason: 'invalid', error: `Remote catalog is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }

  const parsed = CatalogFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return { ok: false, reason: 'invalid', error: `Remote catalog schema violation: ${issues}` }
  }

  const cachePath = remoteCachePath()
  mkdirSync(dirname(cachePath), { recursive: true })
  atomicWriteJson(cachePath, parsed.data)
  return { ok: true, catalog: parsed.data }
}
