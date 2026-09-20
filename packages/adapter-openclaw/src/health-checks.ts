/**
 * OpenClaw adapter health checks (#880) — the adapter's first canonical
 * Health registrations. Composed beside the adapter by the application
 * composition root (same pattern as createPiHealthChecks); never exposed as
 * methods on the runtime contract.
 */
import type { HealthCheckRegistrationInput, HealthCheckRunInput, JsonObject } from '@bakin/core/plugin-types'
import type { RuntimeRoutingSupport } from '@bakin/core/adapters/runtime'
import { healthError, healthHealthy, healthObserved, healthUnknown } from '@bakin/core/health/observation-builders'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { createLogger } from '@bakin/core/logger'

const log = createLogger('adapter-openclaw:health')

const RUNTIME_GROUP = { key: 'runtime', label: 'Runtime' }

interface RoutingConfigLite {
  routes?: Array<{ workClass?: string; model?: string }>
  tagOverrides?: Array<{ tag?: string; model?: string }>
}

function observedHealthy(key: string, summary: string, evidence?: JsonObject): HealthCheckRunInput {
  return healthObserved([healthHealthy({ key, summary, evidence })])
}

export interface OpenClawHealthDeps {
  /** The live adapter's routing support — perTurnModel is DYNAMIC (#880). */
  routingSupport: () => RuntimeRoutingSupport
  /** True once the gateway REPORTED granted scopes (or an admission verdict
   *  landed). False = perTurnModel is the optimistic pre-connect assumption
   *  — the check reports UNKNOWN, never healthy, on unverified evidence. */
  scopesVerified: () => boolean
}

/**
 * `runtime.<adapter>.override-authorization`: per-turn model overrides need
 * `operator.admin` on OpenClaw 2026.9.5. When the connection lacks it AND
 * work-class model routes are configured, every routed turn silently runs
 * on the agent default (clamped with receipts) — a standing state the
 * operator must resolve by authorizing the device or clearing the routes.
 */
export function createOpenClawHealthChecks(deps: OpenClawHealthDeps): HealthCheckRegistrationInput[] {
  return [
    {
      id: 'override-authorization',
      name: 'OpenClaw override authorization',
      description: 'Verifies the gateway connection may carry per-turn model overrides (operator.admin) whenever work-class routes are configured.',
      group: RUNTIME_GROUP,
      run: async () => {
        const perTurnModel = deps.routingSupport().perTurnModel
        const verified = deps.scopesVerified()
        let modelRoutes = 0
        let routesKnown = true
        try {
          const config = await getHookRegistry().invoke<RoutingConfigLite>('models.getRoutingConfig', {})
          modelRoutes = (config?.routes ?? []).filter((r) => r.model).length
            + (config?.tagOverrides ?? []).filter((t) => t.model).length
        } catch (err) {
          // Models plugin absent/unavailable — failed evidence, never a
          // healthy verdict built on a defaulted count (review #2), and
          // never a silent catch.
          routesKnown = false
          log.warn('models.getRoutingConfig unavailable for override-authorization check', { error: String(err) })
        }

        if (!verified) {
          // Missing evidence is UNKNOWN, never healthy: before the first
          // connect ACK, perTurnModel is an optimistic assumption.
          return healthObserved([healthUnknown({
            key: 'override-authorization',
            summary: 'Override authorization is unverified — the gateway connection has not reported its granted scopes yet.',
            evidence: { verified: false, modelRoutes, routesKnown },
            incident: {
              key: 'override-authorization-unverified',
              title: 'OpenClaw override authorization not yet verified',
              impact: !routesKnown
                ? 'Routing configuration could not be read; whether the gateway honors model routes is unknown until the first connection.'
                : modelRoutes > 0
                  ? 'Model routes are configured; whether the gateway honors them is unknown until the first connection.'
                  : 'No model routes configured; nothing depends on override authorization yet.',
              disposition: 'advisory',
              resources: [{ kind: 'setting', id: 'models.routing', label: 'Models → Routing' }],
              resolution: { key: 'verify-connection', type: 'instructions', label: 'Verify', steps: ['Send any agent turn (or restart Bakin) so the gateway connection reports its granted scopes.'] },
            },
          })])
        }

        if (perTurnModel) {
          return observedHealthy(
            'override-authorization',
            'Gateway connection is authorized for per-turn model overrides.',
            { perTurnModel: true, modelRoutes, routesKnown, verified: true },
          )
        }
        if (!routesKnown) {
          // Unauthorized connection AND the route count is unreadable: this
          // is exactly the state the check exists to catch, with half its
          // evidence missing — unknown, never healthy.
          return healthObserved([healthUnknown({
            key: 'override-authorization',
            summary: 'Gateway refuses per-turn model overrides, and the routing configuration could not be read — whether routes are being clamped is unknown.',
            evidence: { perTurnModel: false, routesKnown: false },
            incident: {
              key: 'override-authorization',
              title: 'OpenClaw override authorization cannot be assessed',
              impact: 'The connection lacks model-override authorization; if model routes are configured, routed turns are being clamped to agent defaults.',
              disposition: 'advisory',
              resources: [{ kind: 'setting', id: 'models.routing', label: 'Models → Routing' }],
              resolution: { key: 'retry-check', type: 'instructions', label: 'Retry', steps: ['Re-run the check once the models plugin is available.'] },
            },
          })])
        }
        if (modelRoutes === 0) {
          return observedHealthy(
            'override-authorization',
            'Gateway refuses per-turn model overrides, but no work-class model routes are configured — nothing is clamped.',
            { perTurnModel: false, modelRoutes: 0 },
          )
        }
        return healthObserved([healthError({
          key: 'override-authorization',
          summary: `Gateway refuses per-turn model overrides while ${modelRoutes} model route(s) are configured — routed turns run on agent defaults (clamped with receipts).`,
          evidence: { perTurnModel: false, modelRoutes },
          incident: {
            key: 'override-authorization',
            title: 'OpenClaw connection lacks model-override authorization',
            impact: 'Work-class model routing is inert: every routed turn is clamped to the agent default model. Spend and quality follow agent defaults, not your routes.',
            disposition: 'action_required',
            resources: [{ kind: 'setting', id: 'models.routing', label: 'Models → Routing' }],
            resolution: {
              key: 'authorize-overrides',
              type: 'instructions',
              label: 'Authorize per-turn model overrides',
              steps: [
                'OpenClaw 2026.9.5+ requires the operator.admin scope for per-turn provider/model overrides.',
                "Approve Bakin's paired device with the operator.admin scope (openclaw devices/pairing), or grant admin per identity via gateway.auth.identityScopes.",
                'Then restart Bakin so the gateway reconnects and re-requests the elevated scope.',
                'Alternatively, clear the work-class model routes (Models → Routing) to accept agent-default models.',
              ],
            },
          },
        })])
      },
    },
  ]
}
