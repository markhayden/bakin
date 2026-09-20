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
 * Clamp a resolved route to what the active runtime declares it honors —
 * BOTH knobs: thinking levels (supportedThinkingLevels) and per-turn model
 * overrides (perTurnModel, #880). Clamp-and-warn with receipts — never
 * silent, never a failed turn. Shared by dispatch and system-send
 * resolution (the ONLY capability gate: a route that skips this function
 * skips the #880 clamp). Fail-open: if the capability read fails, the route
 * passes through unchanged (the adapter's own guard is the backstop).
 */
export async function applyRoutingCapabilities(route: ResolvedTurn, workClass: WorkClass): Promise<ResolvedTurn> {
  if (!route.thinking && !route.model) return route
  try {
    // Leaf accessor (app-services-store), NOT the composition root — a
    // ./app-services import here closes the exec-tool/dispatch cycle back
    // to app-services (caught by check:cycles in CI).
    const { getAppServices } = await import('./app-services-store')
    const support = getAppServices().runtime.models.routingSupport()
    let next = route

    // Model overrides the runtime refuses (#880: OpenClaw 2026.9.5 gates
    // them behind operator.admin) — drop the model with a receipt so the
    // turn proceeds on the agent default instead of failing at admission.
    if (next.model && support.perTurnModel === false) {
      const requested = next.model
      log.warn('Model route clamped: runtime refuses per-turn overrides', { workClass, requested })
      next = { ...next, modelClamp: { requested, reason: 'override_denied' } }
      delete next.model
      // Durable receipt for EVERY caller — system sends have no task.routed
      // audit of their own (review finding: system-class clamps left only a
      // log line, violating the receipt+audit contract).
      try {
        const { appendAudit } = await import('./audit')
        const { getContentDir } = await import('./content-dir')
        appendAudit(getContentDir(), 'route.model_clamped', 'system', { workClass, requested, reason: 'override_denied' })
      } catch (auditErr) {
        log.warn('Model-clamp audit not recorded', { workClass, error: String(auditErr) })
      }
    }

    if (next.thinking) {
      const { applied, clamped } = clampThinkingLevel(next.thinking, support.supportedThinkingLevels)
      if (clamped) {
        log.warn('Thinking level clamped to runtime support', { workClass, requested: next.thinking, applied: applied ?? 'inherit' })
        next = { ...next, thinkingClamp: { requested: next.thinking, applied } }
        if (applied) next.thinking = applied
        else delete next.thinking
      }
    }
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
    return await applyRoutingCapabilities(resolveWorkClassRoute(config, workClass), workClass)
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
