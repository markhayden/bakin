/**
 * Budget incident notifications (cost-control v2, #464) — triggered on FRESH
 * incident opens only (the budget_incidents UNIQUE upstream guarantees
 * once-per-(rule, window, kind), restart-safe), never by polling:
 *
 *  1. SSE plugin-event `budget.incident_opened` — the client shell fires a
 *     browser notification (same bell toggle as workflow gates) and
 *     refreshes budget surfaces.
 *  2. One concise message to the MAIN agent via runtime messaging — the
 *     "fully away from the browser" channel (the agent relays to wherever
 *     the operator actually is). Metered like every Bakin-initiated send.
 *
 * Both paths are fire-and-forget: a notify failure is logged and must never
 * block or fail the gate that opened the incident.
 */
import { createLogger } from './logger'
import { broadcast } from './sse'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { BudgetIncidentKind } from './execution-ledger'

const log = createLogger('budget-notify')

export interface BudgetIncidentNotification {
  incidentId: number
  kind: BudgetIncidentKind
  scope: string
  scopeId?: string
  lane: 'metered' | 'subscription'
  window: 'daily' | 'monthly'
  unit: 'usd_micros' | 'tokens'
  capValue: number
  spentValue: number
  atCap: 'defer' | 'pause'
}

function fmtValue(unit: 'usd_micros' | 'tokens', value: number): string {
  return unit === 'usd_micros' ? `$${(value / 1_000_000).toFixed(2)}` : `${value.toLocaleString()} tokens`
}

/** Human line shared by the SSE payload, the agent message, and (via SSE) the browser notification body. */
export function describeBudgetIncident(n: BudgetIncidentNotification): string {
  const scopeLabel = n.scopeId ? `${n.scope} '${n.scopeId}'` : 'global'
  const state =
    n.kind === 'cap'
      ? n.atCap === 'pause'
        ? 'cap reached — dispatch is PAUSED until you resolve the incident'
        : 'cap reached — dispatch defers until the window resets or the cap is raised'
      : 'approaching its cap'
  return `Budget alert: ${scopeLabel} ${n.window} ${n.lane} spend ${fmtValue(n.unit, n.spentValue)} of ${fmtValue(n.unit, n.capValue)} — ${state}.`
}

/**
 * Fan out a freshly-opened incident. Synchronous facade; the agent relay
 * runs detached. Never throws. The runtime is INJECTED by the caller
 * (dispatch-turns already holds app-services) — importing app-services here
 * would close an import cycle back through the dispatch graph.
 */
export function notifyBudgetIncidentOpened(n: BudgetIncidentNotification, getRuntime: () => AgentRuntimeAdapter): void {
  const message = describeBudgetIncident(n)
  try {
    broadcast({ type: 'plugin-event', event: 'budget.incident_opened', ...n, message, timestamp: new Date().toISOString() })
  } catch (err) {
    log.error('Failed to broadcast budget incident', err, { incidentId: n.incidentId })
  }
  void relayToMainAgent(n, message, getRuntime)
}

/** SSE-only companion for resolutions (UI refresh; no agent message). */
export function emitBudgetIncidentResolved(payload: { incidentId: number; resolution: string }): void {
  try {
    broadcast({ type: 'plugin-event', event: 'budget.incident_resolved', ...payload, timestamp: new Date().toISOString() })
  } catch (err) {
    log.error('Failed to broadcast budget incident resolution', err, { incidentId: payload.incidentId })
  }
}

async function relayToMainAgent(n: BudgetIncidentNotification, message: string, getRuntime: () => AgentRuntimeAdapter): Promise<void> {
  try {
    // Dynamic imports keep the notify module out of the static graphs of the
    // many gate call sites (same rationale as agent-cost.ts).
    const [{ getRuntimeMainAgentId }, { meterAgentTurn }] = await Promise.all([
      import('@bakin/core/adapters/runtime'),
      import('./agent-cost'),
    ])
    const runtime = getRuntime()
    const mainAgentId = await getRuntimeMainAgentId(runtime)
    const { resolveSystemRoute, routeSendArgs } = await import('./system-route')
    const route = await resolveSystemRoute('relay')
    const result = await runtime.messaging.send({
      agentId: mainAgentId,
      activityClass: 'system',
      ...routeSendArgs(route),
      content: `${message}\n\nReview and resolve: Models → Spend (or \`bakin budget incidents\`). Relay this to the operator if they are not watching the dashboard.`,
    })
    await meterAgentTurn({ agent: mainAgentId, activityClass: 'system', result, workClass: 'relay', routeSource: route.source, resolvedModel: route.model, name: 'budget-alert' })
  } catch (err) {
    log.error('Failed to relay budget incident to the main agent', err, { incidentId: n.incidentId })
  }
}
