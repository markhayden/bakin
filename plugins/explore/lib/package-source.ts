/**
 * Apply a catalog ref pin to a GitHub source without changing the package
 * fragment. Explore owns this client-safe transport preparation so the plugin
 * does not reach through the SDK boundary into host-private source modules.
 */
export function sourceWithRef(source: string, ref: string | null | undefined): string {
  if (!ref || !source.startsWith('github:')) return source

  const fragmentIndex = source.indexOf('#')
  if (fragmentIndex === -1) return `${source}@${ref}`

  return `${source.slice(0, fragmentIndex)}@${ref}${source.slice(fragmentIndex)}`
}
