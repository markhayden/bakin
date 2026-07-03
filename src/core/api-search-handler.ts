/**
 * Cross-plugin /api/search HTTP handler.
 *
 * Extracted from server.ts so the routing logic can be unit-tested without
 * bootstrapping Next.js. The raw server in server.ts is the only remaining
 * caller — all per-plugin search routes live under /api/plugins/{id}/search.
 *
 * Decision D6 (issue #67 spec): keep this route for future global search.
 */
import type { ServerResponse } from 'http'
import { crossTableSearch } from './search-registry'
import { jsonResponse } from './middleware'
import { createLogger } from './logger'

const log = createLogger('api-search')

export interface SearchHandlerResult {
  status: number
  body: unknown
}

/**
 * Pure handler — returns the response shape without touching `res`.
 * Easy to test: call with a URL, assert on the returned status/body.
 */
export async function handleCrossPluginSearch(url: URL): Promise<SearchHandlerResult> {
  const query = url.searchParams.get('q')
  if (!query) {
    return { status: 400, body: { error: 'Missing ?q= parameter' } }
  }

  try {
    const response = await crossTableSearch(query, {
      table: url.searchParams.get('table') || undefined,
      limit: Number(url.searchParams.get('limit')) || undefined,
      offset: Number(url.searchParams.get('offset')) || undefined,
      facets: url.searchParams.get('facets')?.split(',').filter(Boolean) || undefined,
      types: url.searchParams.get('types')?.split(',').filter(Boolean) || undefined,
    })
    if (response.meta.source === 'unavailable') {
      // Honest degradation (D11): engine down is an explicit 503, never a
      // silent empty result the UI would mistake for "no matches".
      return { status: 503, body: { error: 'search_unavailable' } }
    }
    return { status: 200, body: response }
  } catch (err) {
    log.error('Search request failed', err)
    return {
      status: 500,
      body: { error: err instanceof Error ? err.message : String(err) },
    }
  }
}

/**
 * Adapter for the raw http server in server.ts — writes the result to `res`.
 */
export async function writeCrossPluginSearchResponse(
  url: URL,
  res: ServerResponse
): Promise<void> {
  const { status, body } = await handleCrossPluginSearch(url)
  jsonResponse(res, status, body)
}
