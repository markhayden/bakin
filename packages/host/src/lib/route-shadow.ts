/**
 * Route-shadow detection (routing overhaul PR3, task 3.4).
 *
 * Plugin-contributed routes render through the `$` splat catch-all, and
 * TanStack ranks every explicit host route above the splat — so a plugin
 * pattern that collides with a host path can NEVER render there. That used
 * to fail silently; PluginHost now warns at manifest-seeding time.
 *
 * HOST_STATIC_ROUTE_PATHS is a literal copy of the router.ts wiring (a
 * direct import would close an ESM module cycle through __root/PluginHost);
 * tests/host/route-shadow.test.ts pins it against the router.ts source so
 * the copy can't drift.
 */

export const HOST_STATIC_ROUTE_PATHS = [
  '/',
  '/tasks',
  '/team',
  '/team/teams/$teamId',
  '/team/$id',
  '/workflows',
  '/workflows/new',
  '/workflows/$id',
  '/workflows/$id/edit',
  '/assets',
  '/assets/$assetId',
  '/brands',
  '/brands/$brandId',
  '/brands/$brandId/docs/$kind/$name',
  '/chat',
  '/chat/new',
  '/chat/$chatId',
  '/explore',
  '/health',
  '/memory',
  '/models',
  '/schedule',
  '/settings',
  '/runtime',
] as const

const isDynamicSegment = (seg: string) =>
  seg.startsWith('$') || seg.startsWith(':') || seg.startsWith('[')

/**
 * Two route shapes collide when some URL matches both — literal segments
 * must be equal, dynamic segments match anything, and lengths must agree.
 */
export function routesCollide(pluginPattern: string, hostPath: string): boolean {
  const p = pluginPattern.split('/').filter(Boolean)
  const h = hostPath.split('/').filter(Boolean)
  if (p.length !== h.length) return false
  return p.every((seg, i) => isDynamicSegment(seg) || isDynamicSegment(h[i]) || seg === h[i])
}

/** Host paths a plugin route pattern is shadowed by (empty = renders fine). */
export function findShadowingHostPaths(pluginPattern: string): string[] {
  return HOST_STATIC_ROUTE_PATHS.filter((hostPath) => routesCollide(pluginPattern, hostPath))
}
