/**
 * Route resolution for SYSTEM work classes (auto-titles, enrichment, relays,
 * direct sends, team-routing) — the non-dispatch half of the work-class
 * matrix. Each call site declares its class, resolves here, and passes the
 * result's model/thinking to `messaging.send` plus its source to the meter.
 *
 * Mirrors dispatch's resolveDispatchRouting discipline: config comes from the
 * models plugin via the `models.getRoutingConfig` hook, resolution never
 * throws into the send path, and no config/match = inherit (agent default,
 * exactly as before routing existed).
 */
import { createLogger } from './logger'
import { clampThinkingLevel, resolveWorkClassRoute, type ResolvedTurn, type RoutingConfig, type WorkClass } from './model-routing'

const log = createLogger('system-route')

/**
 * Clamp a resolved route's thinking level to what the active runtime declares
 * it honors (clamp-and-warn — never silent, never a failed turn). Shared by
 * dispatch and system-send resolution. Fail-open: if the capability read
 * fails, the route passes through unchanged (the adapter's own guard is the
 * backstop).
 */
export async function applyThinkingCapability(route: ResolvedTurn, workClass: WorkClass): Promise<ResolvedTurn> {
  if (!route.thinking) return route
  try {
    // Leaf accessor (app-services-store), NOT the composition root — a
    // ./app-services import here closes the exec-tool/dispatch cycle back
    // to app-services (caught by check:cycles in CI).
    const { getAppServices } = await import('./app-services-store')
    const supported = getAppServices().runtime.models.routingSupport().supportedThinkingLevels
    const { applied, clamped } = clampThinkingLevel(route.thinking, supported)
    if (!clamped) return route
    log.warn('Thinking level clamped to runtime support', { workClass, requested: route.thinking, applied: applied ?? 'inherit' })
    const next: ResolvedTurn = { ...route, thinkingClamp: { requested: route.thinking, applied } }
    if (applied) next.thinking = applied
    else delete next.thinking
    return next
  } catch {
    return route
  }
}

export async function resolveSystemRoute(workClass: WorkClass): Promise<ResolvedTurn> {
  try {
    const { getHookRegistry } = await import('@bakin/core/hooks/hook-registry-singleton')
    const config = await getHookRegistry().invoke<RoutingConfig>('models.getRoutingConfig', {})
    if (!config) return { source: 'inherit' }
    return await applyThinkingCapability(resolveWorkClassRoute(config, workClass), workClass)
  } catch (err) {
    log.error('System route resolve failed; using agent default', err, { workClass })
    return { source: 'inherit' }
  }
}

/** Spread helper: the `model`/`thinking` args a resolved route contributes to a send. */
export function routeSendArgs(route: ResolvedTurn): { model?: string; thinking?: string } {
  return {
    ...(route.model ? { model: route.model } : {}),
    ...(route.thinking ? { thinking: route.thinking } : {}),
  }
}
