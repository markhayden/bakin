/**
 * OpenClaw adapter health checks (#880) — the adapter's first canonical
 * Health registrations. Composed beside the adapter by the application
 * composition root (same pattern as createPiHealthChecks); never exposed as
 * methods on the runtime contract.
 */
import type { HealthCheckRegistrationInput, HealthCheckRunInput, HealthIncidentDeclaration, HealthSubject, JsonObject } from '@bakin/core/plugin-types'
import type { RuntimeCompatibility, RuntimeRoutingSupport } from '@bakin/core/adapters/runtime'
import { healthError, healthHealthy, healthObserved, healthUnknown } from '@bakin/core/health/observation-builders'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { createLogger } from '@bakin/core/logger'
import { gatewayCompatibility } from './gateway-rpc'

const log = createLogger('adapter-openclaw:health')

const RUNTIME_GROUP = { key: 'runtime', label: 'Runtime' }

/** Every OpenClaw incident is about the OpenClaw runtime (row subject `runtime:openclaw`). */
export const OPENCLAW_SUBJECT: HealthSubject = { kind: 'runtime', id: 'openclaw', label: 'OpenClaw' }

/**
 * Row 204: the connection lacks `operator.admin` while model routes are
 * configured → human credential (grant the scope or clear the routes).
 * Required only while overrides are configured — the incident is only
 * emitted then, so every instance is required.
 *
 * The grant is OpenClaw's device-pairing scope upgrade (`openclaw devices`,
 * OpenClaw 2026.9.5 CLI reference): Bakin asks for `operator.admin` on
 * connect; a gateway that refuses keeps the existing approval and files a
 * PENDING upgrade request for Bakin's device. The operator lists it
 * (`Requested` vs `Approved`), approves it by id, then restarts Bakin —
 * the gateway client drops the optional scope for its lifetime after a
 * refusal, so only a fresh connection asks again. The handoff's ONE command
 * is the listing (it never fails and prints the request id); the approve
 * and restart steps are named in the impact.
 * Rows 202/203 (unverified, routes unreadable) are observations — no family.
 */
export const OPENCLAW_OVERRIDE_AUTHORIZATION_FAMILY: HealthIncidentDeclaration = {
  id: 'override-authorization',
  subjectKind: 'runtime',
  resolution: { type: 'human', needs: 'credential' },
  required: 'owner-decides',
}
export const OPENCLAW_OVERRIDE_AUTHORIZATION_INCIDENTS: HealthIncidentDeclaration[] = [OPENCLAW_OVERRIDE_AUTHORIZATION_FAMILY]

/** Lists Bakin's device with its pending `operator.admin` upgrade request (`openclaw devices` CLI, 2026.9.5). */
export const OPENCLAW_DEVICES_LIST_COMMAND = 'openclaw devices list'
/** Approves a pending pairing/scope-upgrade request by its id (the id comes from the listing). */
export const OPENCLAW_DEVICES_APPROVE_COMMAND = 'openclaw devices approve <requestId>'
/** Re-dials the gateway so the client asks for the granted scope again (the drop is sticky per connection). */
export const BAKIN_RESTART_COMMAND = 'bakin restart'

/**
 * Gateway protocol floor (#1007 D7.10; the Updates engine's `gateway` row):
 * a gateway whose negotiated protocol is below Bakin's floor cannot carry
 * the event streams Bakin rides. Only the operator can upgrade the OpenClaw
 * install — `openclaw update` is OpenClaw's own updater (npm/git installs,
 * restarts the gateway service after a successful update), so the handoff
 * names it; the check re-reads the handshake evidence on the next run, which
 * the Health card triggers when the operator returns. Required always: the
 * incident exists only while the gateway is below the floor.
 */
export const OPENCLAW_GATEWAY_BELOW_FLOOR_FAMILY: HealthIncidentDeclaration = {
  id: 'gateway-below-floor',
  subjectKind: 'runtime',
  resolution: { type: 'human', needs: 'external-install' },
  required: 'always',
}
export const OPENCLAW_GATEWAY_PROTOCOL_INCIDENTS: HealthIncidentDeclaration[] = [OPENCLAW_GATEWAY_BELOW_FLOOR_FAMILY]
/** OpenClaw's own updater — updates the install via its detected package manager and restarts the gateway service. */
export const OPENCLAW_UPDATE_COMMAND = 'openclaw update'
/** The OpenClaw release where Bakin's protocol floor (4) went live. */
export const OPENCLAW_FLOOR_RELEASE = '2026.6.11'

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
  /** The gateway's protocol floor verdict; defaults to the adapter's cached handshake evidence (never a live probe). */
  compatibility?: () => RuntimeCompatibility
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
      incidents: OPENCLAW_OVERRIDE_AUTHORIZATION_INCIDENTS,
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
          // connect ACK, perTurnModel is an optimistic assumption. Row 202:
          // an observation, not a card — the next connection resolves it.
          return healthObserved([healthUnknown({
            key: 'override-authorization',
            summary: 'Override authorization is unverified — the gateway connection has not reported its granted scopes yet.',
            detail: !routesKnown
              ? 'Routing configuration could not be read; whether the gateway honors model routes is unknown until the first connection. Any agent turn (or a Bakin restart) makes the gateway report its granted scopes.'
              : modelRoutes > 0
                ? 'Model routes are configured; whether the gateway honors them is unknown until the first connection. Any agent turn (or a Bakin restart) makes the gateway report its granted scopes.'
                : 'No model routes configured; nothing depends on override authorization yet.',
            evidence: { verified: false, modelRoutes, routesKnown },
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
          // evidence missing — unknown, never healthy. Row 203: an
          // observation; the check re-runs once the models plugin is back.
          return healthObserved([healthUnknown({
            key: 'override-authorization',
            summary: 'Gateway refuses per-turn model overrides, and the routing configuration could not be read — whether routes are being clamped is unknown.',
            detail: 'The connection lacks model-override authorization; if model routes are configured, routed turns are being clamped to agent defaults. The check re-runs once the models plugin is available.',
            evidence: { perTurnModel: false, routesKnown: false },
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
            declarationId: OPENCLAW_OVERRIDE_AUTHORIZATION_FAMILY.id,
            title: 'OpenClaw connection lacks model-override authorization',
            impact: `Work-class model routing is inert: routed turns are clamped to agent defaults. OpenClaw 2026.9.5+ needs the operator.admin scope for per-turn overrides; the gateway refused it and filed a pending scope-upgrade request for Bakin's device. Run \`${OPENCLAW_DEVICES_LIST_COMMAND}\` (request id + Requested vs Approved), approve with \`${OPENCLAW_DEVICES_APPROVE_COMMAND}\`, then \`${BAKIN_RESTART_COMMAND}\` so the client asks again — or clear the routes under Models → Routing.`,
            disposition: 'action_required',
            subject: OPENCLAW_SUBJECT,
            // Required while overrides are configured — this branch runs only then.
            required: true,
            resources: [{ kind: 'setting', id: 'models.routing', label: 'Models → Routing' }],
            resolution: {
              key: 'authorize-overrides',
              type: 'human',
              needs: 'credential',
              label: 'Approve the operator.admin upgrade',
              href: '/runtime?tab=runtimes',
              handoff: { command: OPENCLAW_DEVICES_LIST_COMMAND },
            },
          },
        })])
      },
    },
    {
      id: 'gateway-protocol',
      name: 'OpenClaw gateway protocol floor',
      description: `Verifies the gateway's negotiated protocol (from the last handshake) meets Bakin's floor; below it, the handoff is OpenClaw's own updater.`,
      group: RUNTIME_GROUP,
      incidents: OPENCLAW_GATEWAY_PROTOCOL_INCIDENTS,
      run: async () => {
        const verdict = (deps.compatibility ?? gatewayCompatibility)()
        const evidence: JsonObject = { required: verdict.required, observed: verdict.observed ?? null, observedAt: verdict.observedAt ?? null, state: verdict.state }
        if (verdict.state === 'unknown') {
          // No handshake this process yet — missing evidence is unknown, never healthy; an observation, not a card.
          return healthObserved([healthUnknown({
            key: 'gateway-protocol',
            summary: 'Gateway protocol is unverified — no connection handshake has been recorded yet.',
            detail: `Bakin requires gateway protocol ${verdict.required} (OpenClaw ${OPENCLAW_FLOOR_RELEASE} or newer). Any agent turn (or a Bakin restart) records the handshake.`,
            evidence,
          })])
        }
        if (verdict.state === 'ok') {
          return observedHealthy('gateway-protocol', `Gateway speaks protocol ${verdict.observed} (floor ${verdict.required}).`, evidence)
        }
        return healthObserved([healthError({
          key: 'gateway-protocol',
          summary: `Gateway protocol ${verdict.observed} is below Bakin's floor ${verdict.required} — streaming turns cannot run until OpenClaw is upgraded.`,
          evidence,
          incident: {
            key: 'gateway-below-floor',
            declarationId: OPENCLAW_GATEWAY_BELOW_FLOOR_FAMILY.id,
            title: 'OpenClaw gateway is below the required protocol',
            impact: `The gateway negotiated protocol ${verdict.observed}; Bakin needs ${verdict.required} (OpenClaw ${OPENCLAW_FLOOR_RELEASE} or newer) for the pushed agent/chat event streams every turn rides. Run \`${OPENCLAW_UPDATE_COMMAND}\` — OpenClaw's updater upgrades the install through its own package manager and restarts the gateway service — then come back; the next handshake re-verifies the floor.`,
            disposition: 'action_required',
            subject: OPENCLAW_SUBJECT,
            resources: [{ kind: 'runtime', id: 'openclaw-gateway', label: 'OpenClaw gateway' }],
            resolution: {
              key: 'upgrade-gateway',
              type: 'human',
              needs: 'external-install',
              label: 'Upgrade OpenClaw',
              href: '/runtime?tab=runtimes',
              handoff: { command: OPENCLAW_UPDATE_COMMAND },
            },
          },
        })])
      },
    },
  ]
}
