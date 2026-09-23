/**
 * models.routing health check + recommended routes (work-class routing pass).
 *
 * One recommendation engine behind three surfaces: the doctor check's warn
 * evidence, POST /routing/recommend (the Routing tab's Apply-recommended
 * ConfirmDialog), and the apply-recommended-routes repair action. Proposals
 * pick the cheapest AVAILABLE model by catalog pricing (tier as fallback);
 * `cheap-vision` classes intersect with the authoritative VISION_MODELS
 * list; a class with no eligible candidate is skipped WITH a reason — never
 * proposed blind.
 */
import type { HealthCheckRunInput, HealthRepairActionDefinition } from '@bakin/core/plugin-types'
import {
  healthHealthy,
  healthObserved,
  healthWarning,
} from '@makinbakin/sdk/utils'
import type { HealthObservationInput } from '@makinbakin/sdk/types'

import { ROUTABLE_WORK_CLASSES, WORK_CLASSES, type RoutingConfig, type WorkClass, type WorkClassRoute } from '../../../src/core/model-routing'
import { listModelRejections, type RunCostSpendRow } from '../../../src/core/execution-ledger'
import { VISION_MODELS } from '@bakin/core/llm/vision-models'
import { getKnownModel } from '../data/known-models'
import { workClassKey } from './spend-rollup'

const TIER_ORDER: Record<string, number> = { budget: 0, standard: 1, premium: 2 }
const SEVEN_DAYS_MS = 7 * 86_400_000
/** Premium-on-cheap escalates advisory→watch past this KNOWN spend in the
 *  window (constant, not a setting — simplicity mandate). */
const PREMIUM_ON_CHEAP_WATCH_USD_MICROS = 5_000_000

export interface RoutingHealthDeps {
  getRoutingConfig(): RoutingConfig
  /** Models usable on the active runtime (available !== false); `tier` is the
   *  runtime-merged tier (catalog or id heuristic) — the catalog alone has no
   *  entries for runtime-private families like openai-codex. */
  listAvailableModels(): Promise<Array<{ id: string; tier?: string }>>
  supportedThinkingLevels(): readonly string[]
  /** Whether the runtime honors per-turn model overrides (#880) — false ⇒
   *  every configured model route is a standing clamp to agent defaults. */
  supportsPerTurnModel(): boolean
  /** run_costs rows for the premium-on-cheap scan window. */
  listRecentRunCosts(sinceMs: number): RunCostSpendRow[]
  /** Open account rejections (#852) — keeps rejected models out of the
   *  recommender pool. Empty on ledger failure: evidence-only, never a gate. */
  listOpenModelRejections(): Array<{ model: string; lastSeenAt: number; occurrences: number }>
  now?(): number
}

export interface RouteProposal {
  workClass: WorkClass
  model: string
  reason: string
}
export interface RouteSkip {
  workClass: WorkClass
  reason: string
}

function pricingRank(id: string): number | null {
  const known = getKnownModel(id)
  if (!known?.pricing) return null
  return known.pricing.inputPer1M + known.pricing.outputPer1M
}

interface Candidate {
  id: string
  /** Runtime-merged tier fallback when the catalog has no entry. */
  tier?: string
}

function tierRank(c: Candidate): number {
  const tier = getKnownModel(c.id)?.tier ?? c.tier
  return tier !== undefined && tier in TIER_ORDER ? TIER_ORDER[tier] : 99
}

function cheapestFirst(a: Candidate, b: Candidate): number {
  const pa = pricingRank(a.id)
  const pb = pricingRank(b.id)
  if (pa !== null && pb !== null && pa !== pb) return pa - pb
  if (pa !== null && pb === null) return -1
  if (pa === null && pb !== null) return 1
  return tierRank(a) - tierRank(b)
}

/** A candidate is "cheap-eligible" when it has catalog pricing or a sub-premium tier. */
function cheapEligible(c: Candidate): boolean {
  return pricingRank(c.id) !== null || tierRank(c) < TIER_ORDER.premium
}

/** Compute the recommended-route proposals for every unrouted recommended class. */
export async function recommendRoutes(deps: RoutingHealthDeps): Promise<{ proposals: RouteProposal[]; skipped: RouteSkip[] }> {
  const config = deps.getRoutingConfig()
  const routed = new Set(config.routes.map((r) => r.workClass))
  const available: Candidate[] = await deps.listAvailableModels()
  const visionIds = new Set(VISION_MODELS.map((m) => m.id))

  const proposals: RouteProposal[] = []
  const skipped: RouteSkip[] = []
  for (const cls of WORK_CLASSES) {
    if (!cls.routable || !cls.recommendedTier || routed.has(cls.id)) continue
    const pool = cls.recommendedTier === 'cheap-vision'
      ? available.filter((c) => visionIds.has(c.id))
      : available.filter(cheapEligible)
    if (pool.length === 0) {
      skipped.push({
        workClass: cls.id,
        reason: cls.recommendedTier === 'cheap-vision'
          ? 'No vision-capable model is available on the active runtime'
          : available.length > 0
            ? 'Only premium-tier models are available on the active runtime — nothing cheaper to route to'
            : 'No models are available on the active runtime',
      })
      continue
    }
    const pick = [...pool].sort(cheapestFirst)[0]
    proposals.push({
      workClass: cls.id,
      model: pick.id,
      reason: cls.recommendedTier === 'cheap-vision' ? 'cheapest vision-capable available model' : 'cheapest available model',
    })
  }
  return { proposals, skipped }
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
    observations.push(healthWarning({
      key: 'routes-model-clamped',
      summary: `The active runtime refuses per-turn model overrides — ${modelRoutes.length + modelTagOverrides.length} model route(s)/override(s) are clamped to agent defaults.`,
      evidence: { workClasses: modelRoutes.map((r) => r.workClass), tags: modelTagOverrides.map((t) => t.tag), perTurnModel: false },
      incident: {
        key: 'routes-model-clamped',
        title: 'Work-class model routes are clamped by the runtime',
        impact: 'Routed turns run on each agent\'s default model (with clamp receipts) — spend and quality follow defaults, not your routes.',
        disposition: 'watch',
        resources: [{ kind: 'setting', id: 'models.routing', label: 'Models → Routing' }],
        resolution: { key: 'authorize-overrides', type: 'navigate', label: 'Review routing', href: '/models?tab=routing' },
      },
    }))
  }

  // 2. Standing clamps — a route asks for a thinking level this runtime clamps.
  const clamping = config.routes.filter((r) => r.thinking && r.thinking !== 'inherit' && !supported.includes(r.thinking))
  for (const r of clamping) {
    observations.push(healthWarning({
      key: `route-thinking-clamped-${r.workClass}`,
      summary: `Route '${r.workClass}' requests thinking '${r.thinking}', which the active runtime clamps — pick a supported level.`,
      evidence: { workClass: r.workClass, requested: r.thinking ?? null, supported: [...supported] },
      incident: {
        key: `route-thinking-clamped-${r.workClass}`,
        title: `Routing thinking level clamps on this runtime (${r.workClass})`,
        impact: 'Turns run at a lower thinking level than configured (clamped with audit evidence).',
        disposition: 'watch',
        resources: [{ kind: 'setting', id: 'models.routing', label: 'Models → Routing' }],
        resolution: { key: 'fix-thinking', type: 'navigate', label: 'Adjust level', href: '/models?tab=routing' },
      },
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
    observations.push(healthWarning({
      key: `premium-on-cheap-${workClass}`,
      summary: `${cell.runs} '${workClass}' turn(s) ran on premium-tier model(s) in the last 7 days (${[...cell.models].join(', ')}).`,
      evidence: {
        workClass,
        runs: cell.runs,
        models: [...cell.models],
        knownUsdMicros: cell.usdMicros,
        unpricedRuns: cell.unpricedRuns,
      },
      incident: {
        key: `premium-on-cheap-${workClass}`,
        title: `Premium model on cheap work (${workClass})`,
        impact: escalated
          ? `Cheap background work billed $${(cell.usdMicros / 1_000_000).toFixed(2)} at premium rates this week — one click routes it to a cheap model.`
          : 'Cheap background work is billing at premium rates. One click routes it to a cheap model.',
        disposition: escalated ? 'watch' : 'advisory',
        resources: [{ kind: 'setting', id: 'models.routing', label: 'Models → Routing' }],
        resolution: { key: 'route-cheaper', type: 'repair', label: 'Apply recommended routes', actionId: 'apply-recommended-routes' },
      },
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

/** Build the live deps from a plugin context — index.ts wiring + the recommend route share it. */
export function buildRoutingHealthDeps(ctx: {
  getSettings<T>(): T
  runtime: { models: { routingSupport(): { supportedThinkingLevels: readonly string[]; perTurnModel?: boolean } } }
}, helpers: {
  readRoutingConfig(): RoutingConfig
  listAvailableModels(): Promise<Array<{ id: string; available?: boolean; tier?: string }>>
  listRunCostsSince(sinceMs: number): RunCostSpendRow[]
}): RoutingHealthDeps {
  return {
    getRoutingConfig: helpers.readRoutingConfig,
    listAvailableModels: async () => (await helpers.listAvailableModels())
      .filter((m) => m.available !== false)
      .map((m) => ({ id: m.id, ...(m.tier ? { tier: m.tier } : {}) })),
    supportedThinkingLevels: () => ctx.runtime.models.routingSupport().supportedThinkingLevels,
    supportsPerTurnModel: () => ctx.runtime.models.routingSupport().perTurnModel !== false,
    listRecentRunCosts: (sinceMs) => {
      try {
        return helpers.listRunCostsSince(sinceMs)
      } catch {
        return [] // ledger down — the check degrades to config-only findings
      }
    },
    listOpenModelRejections: () => {
      try {
        return listModelRejections({ openOnly: true }).map((r) => ({
          model: r.model,
          lastSeenAt: r.lastSeenAt,
          occurrences: r.occurrences,
        }))
      } catch {
        return [] // ledger down — fail open, evidence-only (#852)
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
    async plan() {
      const { proposals } = await recommendRoutes(deps)
      if (proposals.length === 0) return []
      return [{
        id: 'apply-recommended-routes',
        actionId: 'apply-recommended-routes',
        title: `Route ${proposals.length} system class(es) to cheap models`,
        reason: 'Unrouted system classes bill at each agent\'s default model.',
        safety: 'safe',
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
    async apply(items) {
      if (items.length === 0) return []
      try {
        const { proposals } = await recommendRoutes(deps)
        await applyRoutes(proposals.map((p) => ({ workClass: p.workClass, model: p.model })))
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
