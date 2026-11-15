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
    return encodeURIComponent(value)
  })
  return missing ? null : href
}
