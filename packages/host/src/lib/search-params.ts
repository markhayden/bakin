/**
 * Plain-string search-param serializers for the host router (routing
 * overhaul PR3, task 3.1).
 *
 * Bakin's entire URL surface is string params (useQueryState /
 * useQueryArrayState — comma-separated arrays, ids, flags-as-words).
 * TanStack's default JSON serializer coerces "123"→number / "true"→boolean
 * on parse and JSON-quotes scalars on stringify (debug=%221%22); the old
 * SDK shim countered with its own JSON.parse, coercing numeric-looking
 * ids. These serializers make the router treat every value as an opaque
 * string, ending the arms race.
 */

export function parseSearchPlain(searchStr: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(searchStr)) out[key] = value
  return out
}

export function stringifySearchPlain(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}
