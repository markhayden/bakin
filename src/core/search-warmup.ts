/**
 * Search query-path warm-up + a definitive "is search warm" signal.
 *
 * The first semantic query through each in-process embedder cold-compiles its
 * Metal shaders (~10-20s on boot). During that window real queries time out and
 * return nothing — the "search spins 15s then no results" boot symptom. We drive
 * that cost up front in the background and expose getSearchWarmState() so the UI
 * can show "warming up" / "ready" instead of users hitting dead queries.
 */
import { createLogger } from './logger'
import {
  getIndexNames,
  getRegistry,
  getSearchableFields,
  getSearchAdapter,
} from './search-registry-core'

const log = createLogger('search-warmup')

export type SearchWarmState = 'cold' | 'warming' | 'warm'

let warmState: SearchWarmState = 'cold'

/** Definitive, surfaceable signal: has the query-embedding path finished warming. */
export function getSearchWarmState(): SearchWarmState {
  return warmState
}

export function _resetSearchWarmStateForTests(): void {
  warmState = 'cold'
}

// A probe round faster than this means the shaders are compiled (warm).
const WARM_THRESHOLD_MS = 3000
// Stop gating after this regardless — search is usable, we just stop reporting "warming".
const MAX_WARM_MS = 90_000
const POLL_MS = 1500

function probeQuery(table: string): Promise<unknown> {
  // A semantic probe (text → embed) compiles the embedder's query-path shaders.
  // Failures/timeouts are fine — antfly finishes the compile server-side even if
  // our client query gives up, so a later round comes back fast.
  return getSearchAdapter()
    .query(table, {
      text: 'warmup',
      limit: 1,
      adapterOptions: {
        indexes: getIndexNames(table),
        searchableFields: getSearchableFields(table),
      },
    })
    .catch(() => undefined)
}

/**
 * Warm the query-embedding path. Idempotent and fire-and-forget; flips
 * getSearchWarmState() cold → warming → warm.
 */
export async function warmSearchQueryPath(): Promise<void> {
  if (warmState !== 'cold') return
  warmState = 'warming'
  try {
    const search = getSearchAdapter()
    if (!(await search.available())) {
      warmState = 'warm'
      return
    }
    const tables = Array.from(getRegistry().contentTypes.keys())
    if (tables.length === 0) {
      warmState = 'warm'
      return
    }
    const start = Date.now()
    while (Date.now() - start < MAX_WARM_MS) {
      const roundStart = Date.now()
      await Promise.allSettled(tables.map(probeQuery))
      if (Date.now() - roundStart < WARM_THRESHOLD_MS) break
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    log.info(`Search query path warmed in ${Date.now() - start}ms — semantic search is now fast`)
  } catch (err) {
    log.warn('Search warm-up probe failed (search still usable)', err)
  } finally {
    warmState = 'warm'
  }
}
