/**
 * OpenClaw adapter health checks (#880) — the adapter's first canonical
 * Health registrations. Composed beside the adapter by the application
 * composition root (same pattern as createPiHealthChecks); never exposed as
 * methods on the runtime contract.
 */
import type { HealthCheckRegistrationInput, HealthCheckRunInput, JsonObject } from '@bakin/core/plugin-types'
import type { RuntimeRoutingSupport } from '@bakin/core/adapters/runtime'
import { healthError, healthHealthy, healthObserved } from '@bakin/core/health/observation-builders'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'

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
        let modelRoutes = 0
        try {
          const config = await getHookRegistry().invoke<RoutingConfigLite>('models.getRoutingConfig', {})
          modelRoutes = (config?.routes ?? []).filter((r) => r.model).length
            + (config?.tagOverrides ?? []).filter((t) => t.model).length
        } catch {
          // Models plugin absent/unavailable — report on authorization alone.
        }

        if (perTurnModel) {
          return observedHealthy(
            'override-authorization',
            'Gateway connection is authorized for per-turn model overrides.',
            { perTurnModel: true, modelRoutes },
          )
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
