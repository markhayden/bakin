/**
 * Fill a declared entity href template (`contributes.entities[].href`).
 * Pure and dependency-free: the browser (`@makinbakin/sdk/navigation`) and
 * the server resolve links through this one function.
 *
 * `{id}` is always the entity id; other `{name}` placeholders come from
 * `params`. Every value is URL-encoded, so an id can never add a path
 * segment, a query parameter or a fragment. A placeholder with no value
 * yields `null` — callers render no link rather than a half-filled one.
 */
export function fillEntityHref(
  template: string,
  id: string,
  params?: Readonly<Record<string, string>>,
): string | null {
  let missing = false
  const href = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, name: string) => {
    const value = name === 'id' ? id : params?.[name]
    if (typeof value !== 'string' || value === '') {
      missing = true
      return ''
    }
    try {
      return encodeURIComponent(value)
    } catch {
      // A lone surrogate cannot be encoded; an id like that has no link.
      missing = true
      return ''
    }
  })
  return missing ? null : href
}

/** How to address one entity: placeholder values and extra query parameters. */
export interface EntityHrefOptions {
  /** Values for a compound route's placeholders other than `{id}`. */
  params?: Readonly<Record<string, string>>
  /** Extra query parameters for the page (`{ tab: 'diagnostics' }`), appended URL-encoded. */
  query?: Readonly<Record<string, string>>
}

/** Fill a template and append `query`, whether or not the template already has a query string. */
export function buildEntityHref(template: string, id: string, options: EntityHrefOptions = {}): string | null {
  const href = fillEntityHref(template, id, options.params)
  if (href === null) return null
  const extra = Object.entries(options.query ?? {})
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  if (!extra) return href
  return `${href}${href.includes('?') ? '&' : '?'}${extra}`
}
