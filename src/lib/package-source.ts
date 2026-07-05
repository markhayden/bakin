/**
 * Embed a ref pin into a github: package source spec.
 * `github:owner/repo#agents/pixel` + `v1.2.0` → `github:owner/repo@v1.2.0#agents/pixel`.
 * Non-github sources and null refs pass through unchanged.
 *
 * Client + server safe (src/lib) — used by onboarding installs and the
 * explore plugin's install dialog so both honor catalog ref pins the same way.
 */
export function sourceWithRef(source: string, ref: string | null | undefined): string {
  if (!ref) return source
  if (!source.startsWith('github:')) return source
  const hash = source.indexOf('#')
  if (hash === -1) return `${source}@${ref}`
  return `${source.slice(0, hash)}@${ref}${source.slice(hash)}`
}
