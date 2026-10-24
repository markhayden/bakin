/**
 * models.routing health check + the apply-recommended-routes repair.
 *
 * Route proposals come from the ONE model-plan recommender (spec §3.4,
 * `src/core/model-plan.ts` composed by `lib/plan.ts`): the check flags the
 * unrouted chores classes the plan would route, the repair applies exactly
 * those proposals through the selections write path, and GET /plan shows
 * the same list. A class the plan cannot carry is skipped WITH a reason —
 * never proposed blind.
 */
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthRepairActionDefinition } from '@bakin/core/plugin-types'
import {
  healthHealthy,
  healthObserved,
  healthWarning,
} from '@makinbakin/sdk/utils'
import type { HealthObservationInput } from '@makinbakin/sdk/types'

import { ROUTABLE_WORK_CLASSES, WORK_CLASSES, type RoutingConfig, type WorkClassRoute } from '../../../src/core/model-routing'
import type { RunCostSpendRow } from '../../../src/core/execution-ledger'
import { getKnownModel } from '@bakin/core/llm/model-catalog'
import { workClassKey } from '../../../src/core/spend-rollup'
import type { PlanRecommendation } from '../../../src/core/model-plan'
import { routeProposals, type RouteProposal, type RouteSkip } from './plan'

const SEVEN_DAYS_MS = 7 * 86_400_000
/** Premium-on-cheap escalates advisory→watch past this KNOWN spend in the
 *  window (constant, not a setting — simplicity mandate). */
const PREMIUM_ON_CHEAP_WATCH_USD_MICROS = 5_000_000

export interface RoutingHealthDeps {
  getRoutingConfig(): RoutingConfig
  /** The two-lane plan over the eligible catalog — the ONE recommender. */
  recommendPlan(): Promise<PlanRecommendation>
  supportedThinkingLevels(): readonly string[]
  /** Whether the runtime honors per-turn model overrides (#880) — false ⇒
   *  every configured model route is a standing clamp to agent defaults. */
  supportsPerTurnModel(): boolean
  /** run_costs rows for the premium-on-cheap scan window. */
  listRecentRunCosts(sinceMs: number): RunCostSpendRow[]
  now?(): number
}

export type { RouteProposal, RouteSkip }

/**
 * models.routing incident families (re-homing rows 151–156): clamps and
 * on-purpose/unprovable premium routes are observations; the two routable
 * findings carry the one-click routes repair (a routing change widens what
 * the operator authorized — never unattended).
 */
export const MODELS_ROUTING_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'unrouted-system-classes', subjectKind: 'setting', resolution: { type: 'repair', actionId: 'apply-recommended-routes' }, required: 'never' },
  { id: 'premium-on-cheap', subjectKind: 'setting', resolution: { type: 'repair', actionId: 'apply-recommended-routes' }, required: 'never' },
]

/** Route proposals for the UNROUTED chores classes, derived from the plan. */
export async function recommendRoutes(deps: RoutingHealthDeps): Promise<{ proposals: RouteProposal[]; skipped: RouteSkip[] }> {
  return routeProposals(await deps.recommendPlan(), deps.getRoutingConfig())
}

/** The models.routing doctor check — misrouting is detected, not discovered on the bill. */
export async function checkModelRouting(deps: RoutingHealthDeps): Promise<HealthCheckRunInput> {
  const observations: HealthObservationInput[] = []
  const config = deps.getRoutingConfig()
  const supported = deps.supportedThinkingLevels()
  const now = deps.now?.() ?? Date.now()

  // Routes to models that cannot run are the dead-selections check's job
  // (#907): one finding per persisted selection, with a proposal + repair.

  // 1b. Standing model clamps (#880) — the runtime refuses per-turn model
  //     overrides, so every configured model route runs on agent defaults.
  //     One finding for the whole config (the per-turn receipts carry the
  //     per-turn story); same family as thinking clamps.
  const modelRoutes = config.routes.filter((r) => r.model)
  // Tag overrides with models clamp exactly the same way at send time —
  // counting only routes under-reported real standing clamps (review finding).
  const modelTagOverrides = config.tagOverrides.filter((t) => t.model)
  if ((modelRoutes.length > 0 || modelTagOverrides.length > 0) && !deps.supportsPerTurnModel()) {
    // Row 151: an observation — the per-turn receipts carry the story; review at /models?ref=route:relay.
    observations.push(healthWarning({
      key: 'routes-model-clamped',
      summary: `The active runtime refuses per-turn model overrides — ${modelRoutes.length + modelTagOverrides.length} model route(s)/override(s) are clamped to agent defaults.`,
      detail: 'Routed turns run on each agent\'s default model (with clamp receipts) — spend and quality follow defaults, not your routes. Review routing at /models?ref=route:relay.',
      evidence: { workClasses: modelRoutes.map((r) => r.workClass), tags: modelTagOverrides.map((t) => t.tag), perTurnModel: false },
    }))
  }

  // 2. Standing clamps — a route asks for a thinking level this runtime clamps.
  const clamping = config.routes.filter((r) => r.thinking && r.thinking !== 'inherit' && !supported.includes(r.thinking))
  for (const r of clamping) {
    // Row 152: an observation — turns run at a lower level with audit evidence; adjust at /models?ref=route:<wc>.
    observations.push(healthWarning({
      key: `route-thinking-clamped-${r.workClass}`,
      summary: `Route '${r.workClass}' requests thinking '${r.thinking}', which the active runtime clamps — pick a supported level.`,
      detail: `Turns run at a lower thinking level than configured (clamped with audit evidence). Adjust the level at /models?ref=route:${r.workClass}.`,
      evidence: { workClass: r.workClass, requested: r.thinking ?? null, supported: [...supported] },
    }))
  }

  // 3. Unrouted recommended system classes — the cheap-model wins going unused.
  const { proposals } = await recommendRoutes(deps)
  if (proposals.length > 0) {
    // Recent spend per unrouted class as evidence (attributed rows only).
    const rows = deps.listRecentRunCosts(now - SEVEN_DAYS_MS)
    const spendByClass: Record<string, { runs: number; costUsdMicros: number | null }> = {}
    for (const row of rows) {
      const key = workClassKey(row)
      const cell = (spendByClass[key] ??= { runs: 0, costUsdMicros: null })
      cell.runs += 1
      if (row.costUsdMicros !== null) cell.costUsdMicros = (cell.costUsdMicros ?? 0) + row.costUsdMicros
    }
    observations.push(healthWarning({
      key: 'unrouted-system-classes',
      summary: `${proposals.length} system work class(es) run on agent-default models — route them to cheap models (Models → Routing → Apply recommended).`,
      evidence: {
        classes: proposals.map((p) => ({
          workClass: p.workClass,
          proposedModel: p.model,
          last7d: spendByClass[p.workClass] ?? { runs: 0, costUsdMicros: null },
        })),
      },
      incident: {
        key: 'unrouted-system-classes',
        title: 'System work classes are unrouted',
        impact: 'Titles, relays, and other background sends bill at each agent\'s default model instead of a cheap one.',
        disposition: 'advisory',
        subject: { kind: 'setting', id: 'models.routes', label: 'Models → Routing' },
        declarationId: 'unrouted-system-classes',
        resources: [{ kind: 'setting', id: 'models.routing', label: 'Models → Routing' }],
        resolution: { key: 'apply-recommended-routes', type: 'repair', actionId: 'apply-recommended-routes', label: 'Apply recommended routes' },
      },
    }))
  }

  // 4. Premium models observed on cheap-recommended classes (last 7d).
  // Cost optimization is a nice-to-have, not damage (health trust
  // overhaul): ADVISORY with the one-click routes repair, escalating to
  // watch only past a real dollar threshold of KNOWN spend — the ledger's
  // own attributed costs, never estimated, so unpriced rows cannot
  // fabricate an escalation.
  const cheapClasses = new Map(WORK_CLASSES.filter((c) => c.recommendedTier).map((c) => [c.id as string, c]))
  const premiumRuns: Record<string, { runs: number; models: Set<string>; usdMicros: number; unpricedRuns: number }> = {}
  for (const row of deps.listRecentRunCosts(now - SEVEN_DAYS_MS)) {
    const key = workClassKey(row)
    if (!cheapClasses.has(key) || !row.model) continue
    if (getKnownModel(row.model)?.tier !== 'premium') continue
    const cell = (premiumRuns[key] ??= { runs: 0, models: new Set(), usdMicros: 0, unpricedRuns: 0 })
    cell.runs += 1
    cell.models.add(row.model)
    if (row.costUsdMicros === null) cell.unpricedRuns += 1
    else cell.usdMicros += row.costUsdMicros
  }
  for (const [workClass, cell] of Object.entries(premiumRuns)) {
    const escalated = cell.usdMicros > PREMIUM_ON_CHEAP_WATCH_USD_MICROS
    // The repair only routes classes the plan proposes for — a cheaper model
    // that has not been seen running here is never proposed (proof gate).
    const routable = proposals.some((p) => p.workClass === workClass)
    // An explicitly routed class is the operator's choice — the recommender
    // never proposes over it, so the fix is to change that route.
    const routedTo = config.routes.find((r) => r.workClass === workClass)?.model ?? null
    const cheaper = routable
      ? ' — one click routes it to a cheap model.'
      : routedTo
        ? `. It is routed to ${routedTo} on purpose — change that route to a cheaper model if this is not intended.`
        : '. No cheaper model has been seen running here yet; run a task on one or probe it, and Health can route this.'
    const impact = escalated
      ? `Cheap background work billed $${(cell.usdMicros / 1_000_000).toFixed(2)} at premium rates this week${cheaper}`
      : `Cheap background work is billing at premium rates${cheaper}`
    const evidence = {
      workClass,
      runs: cell.runs,
      models: [...cell.models],
      knownUsdMicros: cell.usdMicros,
      unpricedRuns: cell.unpricedRuns,
    }
    // Row 154: routable → the one-click routes repair. Rows 155/156: an
    // explicit route or no proven cheaper model → an observation whose detail
    // says where to look; never a card nobody can act on.
    observations.push(routable
      ? healthWarning({
        key: `premium-on-cheap-${workClass}`,
        summary: `${cell.runs} '${workClass}' turn(s) ran on premium-tier model(s) in the last 7 days (${[...cell.models].join(', ')}).`,
        evidence,
        incident: {
          key: `premium-on-cheap-${workClass}`,
          title: `Premium model on cheap work (${workClass})`,
          impact,
          disposition: escalated ? 'watch' : 'advisory',
          subject: { kind: 'setting', id: `models.route.${workClass}`, label: `Route ${workClass}` },
          declarationId: 'premium-on-cheap',
          resources: [{ kind: 'setting', id: 'models.routing', label: 'Models → Routing' }],
          resolution: { key: 'route-cheaper', type: 'repair', label: 'Apply recommended routes', actionId: 'apply-recommended-routes' },
        },
      })
      : healthWarning({
        key: `premium-on-cheap-${workClass}`,
        summary: `${cell.runs} '${workClass}' turn(s) ran on premium-tier model(s) in the last 7 days (${[...cell.models].join(', ')}).`,
        detail: `${impact} ${routedTo ? `Change the route at /models?ref=route:${workClass}.` : 'Open /models to probe or run a cheaper model.'}`,
        evidence,
      }))
  }

  if (observations.length === 0) {
    const routedCount = config.routes.filter((r) => (ROUTABLE_WORK_CLASSES as readonly string[]).includes(r.workClass)).length
    return healthObserved([healthHealthy({
      key: 'routing',
      summary: `Work-class routing is healthy (${routedCount} route(s); models available; thinking levels supported).`,
    })])
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

/** Build the live deps from a plugin context (index.ts wiring). */
export function buildRoutingHealthDeps(ctx: {
  getSettings<T>(): T
  runtime: { models: { routingSupport(): { supportedThinkingLevels: readonly string[]; perTurnModel?: boolean } } }
}, helpers: {
  readRoutingConfig(): RoutingConfig
  recommendPlan(): Promise<PlanRecommendation>
  listRunCostsSince(sinceMs: number): RunCostSpendRow[]
}): RoutingHealthDeps {
  return {
    getRoutingConfig: helpers.readRoutingConfig,
    recommendPlan: helpers.recommendPlan,
    supportedThinkingLevels: () => ctx.runtime.models.routingSupport().supportedThinkingLevels,
    supportsPerTurnModel: () => ctx.runtime.models.routingSupport().perTurnModel !== false,
    listRecentRunCosts: (sinceMs) => {
      try {
        return helpers.listRunCostsSince(sinceMs)
      } catch {
        return [] // ledger down — the check degrades to config-only findings
      }
    },
  }
}

/** Deterministic repair: apply the same proposals the recommend endpoint computes. */
export function recommendedRoutesRepair(
  deps: RoutingHealthDeps,
  applyRoutes: (routes: WorkClassRoute[]) => void | Promise<void>,
): HealthRepairActionDefinition {
  return {
    id: 'apply-recommended-routes',
    name: 'Apply recommended work-class routes',
    // Rows 153/154: a routing change widens what the operator authorized — one-click, a policy write.
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: true },
    mutation: 'policy',
    operationPlan: () => ({
      stages: [
        { id: 'recommend', kind: 'preparing', label: 'Compute the recommended routes' },
        { id: 'save', kind: 'committing', label: 'Save the routes' },
      ],
      pointOfNoReturn: 'save',
    }),
    async plan() {
      const { proposals } = await recommendRoutes(deps)
      if (proposals.length === 0) return []
      return [{
        id: 'apply-recommended-routes',
        actionId: 'apply-recommended-routes',
        title: `Route ${proposals.length} system class(es) to cheap models`,
        reason: 'Unrouted system classes bill at each agent\'s default model.',
        incidentIds: [],
        observationIds: [],
        preconditions: [],
        changes: proposals.map((p) => ({
          kind: 'setting' as const,
          target: `routing.${p.workClass}`,
          action: 'update' as const,
          description: `${p.workClass} → ${p.model} (${p.reason})`,
        })),
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      try {
        op.stage('recommend')
        const { proposals } = await recommendRoutes(deps)
        op.stage('save')
        for (const p of proposals) op.item('save', { id: p.workClass, label: `${p.workClass} → ${p.model}`, status: 'active' })
        await applyRoutes(proposals.map((p) => ({ workClass: p.workClass, model: p.model })))
        for (const p of proposals) op.item('save', { id: p.workClass, label: `${p.workClass} → ${p.model}`, status: 'done' })
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'applied' as const,
          message: `Applied ${proposals.length} recommended route(s).`,
          affectedCheckIds: ['models.routing'],
          changes: item.changes,
        }))
      } catch (error) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
          affectedCheckIds: ['models.routing'],
          changes: [],
        }))
      }
    },
  }
}
