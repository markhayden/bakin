/**
 * Derives a stable OpenAPI `operationId` from `<scope, method, path>`.
 *
 * Convention: `<scope>.<methodLower>.<slug(path)>` where `slug` is the path
 * with `/` and `:`/`{}` placeholder syntax normalized to a kebab-case
 * identifier. Routes that declare their own `operationId` use that value
 * verbatim; this helper is the default for routes that don't.
 */

export function operationIdFor(scope: string, method: string, path: string): string {
  return `${scope}.${method.toLowerCase()}.${slugifyPath(path)}`
}

/**
 * Convert a route path into a kebab-case slug:
 *   /                     → root
 *   /:taskId/move         → task-id-move
 *   /api/agents/start     → api-agents-start
 *   /sessions/:sessionId/turns/:turnId/  → sessions-session-id-turns-turn-id
 */
function slugifyPath(path: string): string {
  // Strip the leading slash, drop trailing slash, then normalize each segment.
  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (trimmed === '') return 'root'
  const segments = trimmed.split('/').map(seg => {
    if (seg.startsWith(':')) return camelToKebab(seg.slice(1))
    if (seg.startsWith('{') && seg.endsWith('}')) return camelToKebab(seg.slice(1, -1))
    return camelToKebab(seg)
  }).filter(Boolean)
  return segments.join('-')
}

function camelToKebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}
