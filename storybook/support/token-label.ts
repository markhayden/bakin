/**
 * Friendly display name for a token path: the last two segments, humanized —
 * `semantic.layout.space.2` reads as "Space 2". The CSS custom property stays
 * the canonical identity; this is the readable line above it.
 */
export function tokenLabel(path: string): string {
  const segments = path.replace(/^semantic\./, '').split('.')
  const tail = segments.slice(-2).join(' ')
  return tail.charAt(0).toUpperCase() + tail.slice(1)
}
