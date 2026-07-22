/**
 * Plain-string search-param serializers shared by the host and browser
 * fixture router. Values remain opaque strings instead of TanStack's default
 * JSON coercion, matching `useQueryState` and `useQueryArrayState`.
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
  const query = params.toString()
  return query ? `?${query}` : ''
}
