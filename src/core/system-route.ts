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
import { resolveWorkClassRoute, type ResolvedTurn, type RoutingConfig, type WorkClass } from './model-routing'

const log = createLogger('system-route')

export async function resolveSystemRoute(workClass: WorkClass): Promise<ResolvedTurn> {
  try {
    const { getHookRegistry } = await import('@bakin/core/hooks/hook-registry-singleton')
    const config = await getHookRegistry().invoke<RoutingConfig>('models.getRoutingConfig', {})
    if (!config) return { source: 'inherit' }
    return resolveWorkClassRoute(config, workClass)
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
