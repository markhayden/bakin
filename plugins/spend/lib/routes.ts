/**
 * Spend plugin REST routes (declarative).
 *
 *   GET  /spend                    windowed rollups + cap-window facets + pace
 *   GET  /coverage                 observed-days coverage + the limit suggestion (D27)
 *   GET  /limits                   the limits policy (rules with ids)
 *   PUT  /limits                   replace the rule list (ids server-assigned)
 *   GET  /status[?lite=1]          live gate status — the poll behind badges/banner
 *                                  (lite = kill switch + ladder rows only, no facets)
 *   GET  /incidents[?all=1]        durable breach records
 *   POST /incidents/:id/resolve    raise | ack | resume (resume ⇒ 409 still_over_limit while over)
 *   POST /milestones/:id/ack       dismiss a milestone bar for its window
 *   PUT  /billing/overrides        manual lane assignments
 *
 * Every read that touches the ledger degrades honestly (503 when the ledger
 * is down) — never a silent "$0".
 */
import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { PluginContext } from '@bakin/core/plugin-types'
import { defineRoute } from '@bakin/core/routing'
import { normalizeModelId } from '@bakin/core/llm/model-id'
import { KNOWN_PROVIDERS } from '@bakin/core/llm/model-catalog'

import {
  acknowledgeMilestone,
  findOpenCapIncident,
  listBudgetIncidents,
  listMilestones,
  listRunCostsSince,
  resolveBudgetIncident,
  resolveExpiredBudgetIncidents,
  LedgerUnavailableError,
  type BudgetIncidentRow,
  type BudgetMilestoneRow,
} from '../../../src/core/execution-ledger'
import { assembleBudgetSpend, paceProjection, dayEndMs, monthEndMs, type BudgetSpendFacets, type LaneSums, type ScopeSpend } from '../../../src/core/budget-spend'
import { evaluateBudget, dayStartMs, monthStartMs, type BudgetPolicy, type BudgetRule } from '../../../src/core/budget'
import { buildSpendTimeline, rollupSpend } from '../../../src/core/spend-rollup'
import { getSettings as getSystemSettings } from '../../../src/core/settings'
import { emitBudgetIncidentResolved, emitSpendMilestoneAcknowledged } from '../../../src/core/budget-notify'
import { createLogger } from '../../../src/core/logger'
import { resolveBilling } from './billing'
import { coverageSummary, suggestMonthlyLimit } from './coverage'
import { coveredDaysSince } from '@bakin/core/usage-history/store'
import {
  BillingOverridesSchema,
  readLimits,
  readOverrides,
  readSpendSettings,
  ruleListIssues,
  SpendRevisionStaleError,
  SpendSettingsInvalidError,
  spendRevision,
  withSpendPolicyWrite,
  type SpendPluginSettings,
} from './settings'

const log = createLogger('spend:routes')

/**
 * The two policy-write refusals every writer can hit, mapped once: a stale
 * revision is 409 (reload and re-decide), an invalid document on disk is
 * 422 (fix the file — dispatch is failing closed until then). Anything else
 * is a 500 with its stack logged.
 */
function policyErrorResponse(err: unknown, route: string): Response {
  if (err instanceof SpendRevisionStaleError) {
    return Response.json({ error: err.code, message: err.message, current: err.current }, { status: 409 })
  }
  if (err instanceof SpendSettingsInvalidError) {
    return Response.json({ error: err.code, message: err.message, file: err.file, issues: err.issues }, { status: 422 })
  }
  if (err instanceof LedgerUnavailableError) return Response.json({ error: 'Spend ledger unavailable' }, { status: 503 })
  log.error(`spend route ${route} failed`, err, { route })
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
}

/** After any policy write: the ladder/incidents reflect the new rules NOW, not at the next tick. */
function observeAfterPolicyWrite(reason: string): void {
  void import('../../../src/core/spend-observer')
    .then((m) => m.observeSpend())
    .catch((err: unknown) => log.warn('spend observer pass after a policy write failed', { reason, err: err instanceof Error ? err.message : String(err) }))
}

/** A cap in the rule's unit (micro-USD for metered, tokens for subscription), or null when the window has no cap. */
function capInUnit(rule: BudgetRule, window: 'daily' | 'monthly'): number | null {
  const cap = window === 'daily' ? rule.dailyCap : rule.monthlyCap
  if (cap === undefined) return null
  return rule.lane === 'metered' ? Math.round(cap * 1_000_000) : Math.round(cap)
}

/**
 * Reconcile live incidents with a freshly written rule list. Every case an
 * edit can produce is handled, not just "identity gone":
 *   - identity gone, or the incident's window no longer has a cap  ⇒ rule_removed
 *   - same identity under a NEW id (a recreated rule starts fresh)  ⇒ rule_removed
 *   - the incident's cap was raised above what it recorded            ⇒ raised
 * Both resolutions are reopenable, so a still-over cap re-breaches as a
 * new episode on the observer pass that follows the write.
 */
function reconcileIncidentsAfterPolicyWrite(previous: readonly BudgetRule[], next: readonly BudgetRule[]): void {
  try {
    for (const incident of listBudgetIncidents({ openOnly: true })) {
      const rule = next.find((r) => ruleMatchesIncident(r, incident))
      const before = previous.find((r) => ruleMatchesIncident(r, incident))
      const cap = rule ? capInUnit(rule, incident.window) : null
      let resolution: 'rule_removed' | 'raised' | null = null
      if (!rule || cap === null) resolution = 'rule_removed'
      else if (before && before.id !== rule.id) resolution = 'rule_removed'
      else if (cap > incident.capValue) resolution = 'raised'
      if (!resolution) continue
      resolveBudgetIncident({ id: incident.id, status: 'resolved', resolution })
      emitBudgetIncidentResolved({ incidentId: incident.id, resolution })
    }
  } catch (err) {
    log.warn('could not reconcile incidents after a limits write', { err: err instanceof Error ? err.message : String(err) })
  }
}

const okResponse = z.object({ ok: z.boolean(), warnings: z.array(z.string()).optional() })
const errorResponse = z.object({ error: z.string() })
const passthrough = z.object({}).passthrough()

// Spend reporting windows. Coarser than the live-usage 5m/1h windows —
// spend is a daily/monthly story. 'all' = since the beginning of time.
type SpendWindow = '24h' | '7d' | '30d' | 'all'
const SPEND_WINDOW_MS: Record<Exclude<SpendWindow, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
}
function parseSpendWindow(raw: string | null): SpendWindow {
  return raw === '7d' || raw === '30d' || raw === 'all' ? raw : '24h'
}

/** The roster row the status route needs — served by the models plugin (which model), read here (what it costs). */
interface AgentModelRow { agentId: string; effectiveModel: string | null }

async function listAgentModels(ctx: PluginContext): Promise<AgentModelRow[]> {
  try {
    const rows = await ctx.hooks.invoke<AgentModelRow[]>('models.listAgentModels', {})
    return Array.isArray(rows) ? rows : []
  } catch (err) {
    // Runtime/models unreachable — status degrades to global/provider info.
    log.warn('agent roster unavailable for spend status', { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

export type AgentBudgetStatus = 'ok' | 'deferred'

/** Worst decision for an (agent, prospective model) across both lanes — the
 *  same evaluation the gate runs, without its side effects. */
async function gateStatusFor(
  ctx: PluginContext,
  policy: BudgetPolicy,
  facets: BudgetSpendFacets,
  agentId: string,
  model: string | null,
): Promise<AgentBudgetStatus> {
  const billing = await resolveBilling(ctx, { agentId, model })
  const resolvedModel = model ?? undefined
  // Pause-mode incidents block regardless of current spend — mirror the gate.
  for (const rule of policy.rules ?? []) {
    if (rule.atCap !== 'pause') continue
    const matches =
      rule.lane === billing.lane &&
      (rule.scope === 'global' ||
        (rule.scope === 'agent' && rule.scopeId === agentId) ||
        (rule.scope === 'provider' && rule.scopeId === billing.provider) ||
        (rule.scope === 'model' && rule.scopeId === resolvedModel))
    if (matches && findOpenCapIncident({ scope: rule.scope, scopeId: rule.scopeId, lane: rule.lane })) return 'deferred'
  }
  const decision = evaluateBudget({
    policy,
    turn: { agent: agentId, provider: billing.provider, model: resolvedModel, lane: billing.lane },
    facets,
  })
  return decision.action === 'defer' ? 'deferred' : 'ok'
}

/** The rule's current spend in its unit — same extraction the evaluator uses. */
function ruleSpend(rule: BudgetRule, facets: BudgetSpendFacets, window: 'daily' | 'monthly'): number {
  const w = window === 'daily' ? facets.daily : facets.monthly
  const bucket: ScopeSpend | LaneSums | undefined =
    rule.scope === 'global' ? w.global
    : rule.scope === 'agent' ? w.byAgent[rule.scopeId ?? '']
    : rule.scope === 'provider' ? w.byProvider[rule.scopeId ?? '']
    : w.byModel[rule.scopeId ?? '']
  if (!bucket) return 0
  const unattributed = (bucket as Partial<ScopeSpend>).unattributed
  return rule.lane === 'subscription'
    ? bucket.subscriptionTokens + (unattributed?.subscriptionTokens ?? 0)
    : bucket.meteredUsdMicros + (unattributed?.meteredUsdMicros ?? 0)
}

function ruleMatchesIncident(rule: BudgetRule, incident: BudgetIncidentRow): boolean {
  return rule.scope === incident.scope && (rule.scopeId ?? '') === incident.scopeId && rule.lane === incident.lane
}

function sweepRollover(): void {
  // Maintenance-on-read: a quiet board (no dispatch attempts) must not show
  // yesterday's rolled-over defer incidents as live forever.
  try {
    const now = Date.now()
    resolveExpiredBudgetIncidents({ dailyWindowStartMs: dayStartMs(now), monthlyWindowStartMs: monthStartMs(now), now })
  } catch (err) {
    log.warn('incident rollover sweep failed on read', { err: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * The ladder rows the header/badge render: milestone rows for the CURRENT
 * daily and monthly windows of rules that still exist (a deleted rule's
 * rows are history, not attention), below 100 (the incident speaks for
 * 100), recorded against the rule's CURRENT cap (a row crossed under a cap
 * since raised is history too — its "$90 of $100" would misstate the
 * present), oldest crossing first.
 */
function liveMilestones(policy: BudgetPolicy, now: number): BudgetMilestoneRow[] {
  const byId = new Map((policy.rules ?? []).filter((r): r is BudgetRule & { id: string } => typeof r.id === 'string').map((r) => [r.id, r]))
  const windowStarts = { daily: dayStartMs(now), monthly: monthStartMs(now) }
  // A row the cap incident already speaks for (the same rule's window is
  // AT the cap) is history: a 49%→101% jump must not raise a yellow bar
  // beside the red one, and an earlier 90 warning retires when 100 lands.
  const superseded = (rule: BudgetRule, window: 'daily' | 'monthly'): boolean => {
    const open = findOpenCapIncident({ scope: rule.scope, scopeId: rule.scopeId, lane: rule.lane })
    return open !== null && open.window === window
  }
  return listMilestones({ sinceMs: windowStarts.monthly })
    .filter((row) => {
      const rule = byId.get(row.ruleId)
      return rule !== undefined
        && row.milestone < 100
        && row.windowStartMs === windowStarts[row.window]
        && capInUnit(rule, row.window) === row.capValue
        && !superseded(rule, row.window)
    })
}

const ResolveIncidentSchema = z.object({
  action: z.enum(['raise', 'ack', 'resume']),
  /** New cap for 'raise', in the rule's unit (whole USD or tokens). */
  cap: z.number().positive().optional(),
})

/**
 * PUT /limits body: the same rule shape, id optional (assigned on save),
 * plus the revision the editor loaded — a snapshot that never saw the
 * current limits cannot replace them.
 */
const PutLimitsSchema = z.object({
  revision: z.string().min(1),
  rules: z.array(
    z
      .object({
        id: z.string().min(1).optional(),
        scope: z.enum(['global', 'agent', 'provider', 'model']),
        scopeId: z.string().min(1).optional(),
        lane: z.enum(['metered', 'subscription']),
        dailyCap: z.number().positive().optional(),
        monthlyCap: z.number().positive().optional(),
        atCap: z.enum(['defer', 'pause']).optional(),
      })
      .refine((r) => r.scope === 'global' || typeof r.scopeId === 'string', {
        message: 'scopeId is required for agent/provider/model rules',
      })
      .refine((r) => r.dailyCap !== undefined || r.monthlyCap !== undefined, {
        message: 'a limit needs a daily or a monthly cap',
      }),
  ).superRefine((rules, ctx) => {
    for (const message of ruleListIssues(rules)) ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  }),
})

/** A rule as the file stores it (id always present). */
type StoredRule = SpendPluginSettings['limits']['rules'][number]

/** GET /limits payload: the policy plus the revision every write must present. */
function limitsPayload(document: SpendPluginSettings): Record<string, unknown> {
  return { ...document.limits, revision: spendRevision(document) }
}

export const spendRoutes = [
  defineRoute({
    path: '/spend',
    method: 'GET',
    summary: 'Estimated agent spend over a window',
    description: 'Windowed token/cost rollups from the execution ledger (total, by agent, by model, by work class) plus the calendar cap-window facets and pace projections. Costs are estimates — cache-token rates default to a fixed multiple of input where a model does not declare exact rates.',
    responses: { 200: passthrough, 503: errorResponse, 500: errorResponse },
    handler: async (req) => {
      try {
        const window = parseSpendWindow(new URL(req.url).searchParams.get('window'))
        const now = Date.now()
        const sinceMs = window === 'all' ? 0 : now - SPEND_WINDOW_MS[window]
        // NULL-honest rollups over raw rows (the ledger GROUP-BY verbs whose
        // COALESCE fabricated $0 for unpriced buckets are gone).
        const rows = listRunCostsSince(sinceMs)
        const rollups = rollupSpend(rows)
        const timeline = buildSpendTimeline(rows, window, now)
        // Cap-window facets from the shared engine (lane/provider split +
        // pace) ride alongside the rolling browse rollups — utilization
        // always computes on calendar cap windows, whatever the selector.
        const facets = await assembleBudgetSpend(now)
        const pace = {
          daily: {
            meteredUsdMicros: paceProjection(facets.daily.global.meteredUsdMicros + facets.daily.global.unattributed.meteredUsdMicros, facets.daily.startMs, dayEndMs(now), now),
            subscriptionTokens: paceProjection(facets.daily.global.subscriptionTokens + facets.daily.global.unattributed.subscriptionTokens, facets.daily.startMs, dayEndMs(now), now),
            endsMs: dayEndMs(now),
          },
          monthly: {
            meteredUsdMicros: paceProjection(facets.monthly.global.meteredUsdMicros + facets.monthly.global.unattributed.meteredUsdMicros, facets.monthly.startMs, monthEndMs(now), now),
            subscriptionTokens: paceProjection(facets.monthly.global.subscriptionTokens + facets.monthly.global.unattributed.subscriptionTokens, facets.monthly.startMs, monthEndMs(now), now),
            endsMs: monthEndMs(now),
          },
        }
        // Pace basis (D27): how many of this month's days Bakin actually
        // watched — the Overview says "based on N observed days" instead of
        // presenting a projection as if every day were counted.
        const daysIntoMonth = Math.floor((now - facets.monthly.startMs) / 86_400_000) + 1
        let observedDays: number | null = null
        try {
          observedDays = coveredDaysSince(daysIntoMonth, now).length
        } catch (err) {
          log.warn('coverage receipts unavailable for the pace basis', { err: err instanceof Error ? err.message : String(err) })
        }
        return Response.json({
          window,
          estimated: true,
          totalUsdMicros: rollups.totalUsdMicros,
          byAgent: rollups.byAgent,
          byModel: rollups.byModel,
          byWorkClass: rollups.byWorkClass,
          timeline,
          facets,
          pace,
          observedDays: { month: observedDays, daysIntoMonth },
        })
      } catch (err) {
        return policyErrorResponse(err, 'GET /spend')
      }
    },
  }),

  defineRoute({
    path: '/coverage',
    method: 'GET',
    summary: 'Observed-days coverage and the limit suggestion',
    description: 'Which of the last 30 local days Bakin actually watched (complete usage sweeps), spend on those days vs. on unobserved days (both from the one spend engine), and the monthly-limit suggestion with its basis — or the honest reason there is none yet.',
    responses: { 200: passthrough, 503: errorResponse, 500: errorResponse },
    handler: async () => {
      try {
        const summary = await coverageSummary()
        const suggestion = await suggestMonthlyLimit(summary)
        return Response.json({
          lookbackDays: summary.lookbackDays,
          computedAt: summary.computedAt,
          coveredDays: summary.coveredDays,
          uncoveredDays: summary.uncoveredDays,
          covered: { window: summary.covered.window, evidence: summary.covered.spendEvidence, observedUsageEvidence: summary.covered.observedUsageEvidence },
          uncovered: { window: summary.uncovered.window, evidence: summary.uncovered.spendEvidence, observedUsageEvidence: summary.uncovered.observedUsageEvidence },
          suggestion,
        })
      } catch (err) {
        return policyErrorResponse(err, 'GET /coverage')
      }
    },
  }),

  defineRoute({
    path: '/limits',
    method: 'GET',
    summary: 'Spend limits policy',
    description: 'The rule list dispatch consults (each rule carries its server-assigned id), the accept-unattributed cutoff, and the `revision` every write must present. 422 when spend.json exists but is not a valid policy (dispatch fails closed until it is fixed).',
    responses: { 200: passthrough, 422: errorResponse, 500: errorResponse },
    handler: async () => {
      try {
        return Response.json(limitsPayload(readSpendSettings()))
      } catch (err) {
        return policyErrorResponse(err, 'GET /limits')
      }
    },
  }),

  defineRoute({
    path: '/limits',
    method: 'PUT',
    summary: 'Replace the spend limits',
    description: 'Every rule round-trips; ids are kept when present and assigned when absent (a rule with a fresh id starts its milestone ladder fresh). Requires the `revision` the editor loaded — 409 stale_revision when the limits changed since. One rule per (scope, scopeId, lane): put both caps on it. Live incidents are reconciled: deleted rules / removed window caps / recreated ids resolve rule_removed, a raised cap resolves raised. Unknown scope ids warn (a typo caps nothing) but never block the save.',
    body: PutLimitsSchema,
    responses: { 200: okResponse, 400: errorResponse, 409: errorResponse, 422: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        // Unknown scope ids are the #1 fake-safety trap (a typo'd agent id
        // caps nothing) — warn, don't reject (the id may exist later). The
        // roster read happens BEFORE the write turn so no await sits inside it.
        const knownAgents = new Set((await listAgentModels(ctx as unknown as PluginContext)).map((a) => a.agentId))
        const knownProviders = new Set(KNOWN_PROVIDERS.map((p) => p.id))
        // Model-scoped rule ids normalize on write so they key identically
        // to the normalized model ids on spend rows.
        const rules: StoredRule[] = body.rules.map((r) => ({
          ...r,
          id: r.id ?? randomUUID(),
          ...(r.scope === 'model' && r.scopeId ? { scopeId: normalizeModelId(r.scopeId) } : {}),
        }))
        const { result: previous, revision } = await withSpendPolicyWrite<BudgetRule[]>((current) => ({
          next: { ...current, limits: { ...current.limits, rules } },
          result: current.limits.rules as BudgetRule[],
        }), { expectRevision: body.revision })
        reconcileIncidentsAfterPolicyWrite(previous, rules as BudgetRule[])
        const warnings: string[] = []
        for (const r of rules) {
          if (r.scope === 'agent' && r.scopeId && knownAgents.size > 0 && !knownAgents.has(r.scopeId)) {
            warnings.push(`No agent named '${r.scopeId}' — this rule caps nothing until such an agent exists.`)
          }
          if (r.scope === 'provider' && r.scopeId && !knownProviders.has(r.scopeId)) {
            warnings.push(`Unknown provider '${r.scopeId}' — this rule caps nothing (known: ${KNOWN_PROVIDERS.map((p) => p.id).join(', ')}).`)
          }
        }
        ctx.activity.audit('budget.updated', 'system', { rules: rules.length, warnings: warnings.length })
        ctx.activity.log('system', 'Updated spend limits', { category: 'spend' })
        observeAfterPolicyWrite('limits updated')
        return Response.json({ ok: true, revision, ...(warnings.length ? { warnings } : {}) })
      } catch (err) {
        return policyErrorResponse(err, 'PUT /limits')
      }
    },
  }),

  defineRoute({
    path: '/status',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Live budget gate status (side-effect-free)',
    description: 'Kill-switch state, per-agent gate status (ok | deferred), per-task holds for todo tasks, per-agent billing lanes, providers currently deferred by provider rules, and open incidents — the poll behind task badges and the pause banner. ?lite=1 returns only the kill-switch bit. Never opens incidents or audits.',
    responses: { 200: passthrough, 503: errorResponse, 500: errorResponse },
    handler: async (req, ctx) => {
      try {
        const paused = getSystemSettings().dispatch.paused
        const policy = readLimits()
        // ?lite=1 — the header's poll wants the kill switch and the ladder
        // rows (milestones + open incidents — cheap ledger reads); skip the
        // facets/agents/per-task work entirely.
        if (new URL(req.url).searchParams.get('lite') === '1') {
          sweepRollover()
          return Response.json({ paused, milestones: liveMilestones(policy, Date.now()), openIncidents: listBudgetIncidents({ openOnly: true }) })
        }
        sweepRollover()
        const overrides = readOverrides()
        const openIncidents = listBudgetIncidents({ openOnly: true })
        const milestones = liveMilestones(policy, Date.now())
        const agents = await listAgentModels(ctx as unknown as PluginContext)
        const billing: Record<string, { provider: string; lane: 'metered' | 'subscription'; model: string | null }> = {}
        for (const agent of agents) {
          const agentBilling = await resolveBilling(ctx as unknown as PluginContext, { agentId: agent.agentId, model: agent.effectiveModel })
          billing[agent.agentId] = { ...agentBilling, model: agent.effectiveModel }
        }
        if (!policy.rules?.length) {
          return Response.json({ paused, configured: false, perAgent: {}, perTask: {}, billing, overrides, deferredProviders: [], openIncidents, milestones })
        }
        const facets = await assembleBudgetSpend(Date.now())
        const perAgent: Record<string, AgentBudgetStatus> = {}
        const effectiveModelByAgent = new Map<string, string | null>()
        for (const agent of agents) {
          effectiveModelByAgent.set(agent.agentId, agent.effectiveModel)
          perAgent[agent.agentId] = await gateStatusFor(ctx as unknown as PluginContext, policy, facets, agent.agentId, agent.effectiveModel)
        }
        const deferredProviders = (policy.rules ?? [])
          .filter((r) => r.scope === 'provider' && r.scopeId)
          .filter((r) =>
            evaluateBudget({ policy: { rules: [r] }, turn: { agent: '', provider: r.scopeId, lane: r.lane }, facets }).action === 'defer' ||
            (r.atCap === 'pause' && findOpenCapIncident({ scope: 'provider', scopeId: r.scopeId, lane: r.lane }) !== null),
          )
          .map((r) => r.scopeId as string)

        // Per-TASK holds for todo tasks — the badge's source of truth. Uses
        // the SAME routing resolution the gate runs (tag/origin overrides can
        // route a task to a capped provider even when the agent's default
        // status is ok) and the main-agent fallback for unassigned tasks.
        const perTask: Record<string, 'deferred'> = {}
        try {
          // Dynamic imports keep the dispatch fire-core (and its task-store
          // graph) out of the plugin's static imports.
          const [{ resolveDispatchRouting }, { readTaskboard }, { getRuntimeMainAgentId }, { loadDispatchState, getFailureRecord }, { getContentDir }] = await Promise.all([
            import('../../../src/core/dispatch-turns'),
            import('../../../src/core/task-store'),
            import('@bakin/core/adapters/runtime'),
            import('../../../src/core/dispatch-state'),
            import('../../../src/core/content-dir'),
          ])
          const mainAgentId = await getRuntimeMainAgentId((ctx as unknown as PluginContext).runtime)
          const { columns } = readTaskboard()
          // Recovery re-dispatches route to the 'recovery' origin — the badge
          // must evaluate the same model the gate will.
          let failedDispatches: Record<string, unknown> = {}
          try {
            failedDispatches = loadDispatchState(getContentDir()).failedDispatches ?? {}
          } catch (err) {
            log.warn('dispatch state unreadable for per-task holds', { err: err instanceof Error ? err.message : String(err) })
          }
          for (const task of columns.todo ?? []) {
            const agentId = task.agent ?? mainAgentId
            const isRecovery = Boolean(getFailureRecord(failedDispatches[task.id] as never)?.sessionDeath)
            let routedModel: string | null = null
            try {
              const routing = await resolveDispatchRouting(task as never, isRecovery)
              routedModel = routing.model ?? null
            } catch (err) {
              log.debug('routing resolution failed for a todo task; inheriting the agent default', { taskId: task.id, err: err instanceof Error ? err.message : String(err) })
            }
            // Normalize like the gate's resolveBilling hook does — a bare
            // claude-* id in a routing override must key model rules identically.
            const rawModel = routedModel ?? effectiveModelByAgent.get(agentId) ?? null
            const model = rawModel ? normalizeModelId(rawModel) : null
            const status = await gateStatusFor(ctx as unknown as PluginContext, policy, facets, agentId, model)
            if (status === 'deferred') perTask[task.id] = 'deferred'
          }
        } catch (err) {
          // Taskboard/dispatch graph unreadable — badges degrade to perAgent.
          log.warn('perTask hold computation failed', { err: err instanceof Error ? err.message : String(err) })
        }
        return Response.json({ paused, configured: true, perAgent, perTask, billing, overrides, deferredProviders: [...new Set(deferredProviders)], openIncidents, milestones })
      } catch (err) {
        return policyErrorResponse(err, 'GET /status')
      }
    },
  }),

  defineRoute({
    path: '/incidents',
    method: 'GET',
    summary: 'Budget incidents (durable breach records)',
    description: 'Open (live) incidents by default; ?all=1 includes resolved history. Each row carries its episode and event id.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (req) => {
      try {
        sweepRollover()
        const all = new URL(req.url).searchParams.get('all') === '1'
        return Response.json({ incidents: listBudgetIncidents(all ? {} : { openOnly: true }) })
      } catch (err) {
        return policyErrorResponse(err, 'GET /incidents')
      }
    },
  }),

  defineRoute({
    path: '/incidents/:id/resolve',
    method: 'POST',
    summary: 'Resolve a budget incident',
    description: "raise: set a new cap (must exceed current spend in the rule's unit) on the breached rule and resume. ack: stop alerting, keep deferring until the window rolls. resume: clear (e.g. unblock a pause-mode hold) without raising.",
    params: z.object({ id: z.string().regex(/^\d+$/) }),
    body: ResolveIncidentSchema,
    responses: { 200: okResponse, 400: errorResponse, 404: errorResponse, 409: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      try {
        const id = Number(params.id)
        const incident = listBudgetIncidents({}).find((i) => i.id === id)
        if (!incident) return Response.json({ error: `No incident ${id}` }, { status: 404 })
        if (incident.status === 'resolved') return Response.json({ error: `Incident ${id} is already resolved` }, { status: 400 })

        if (body.action === 'ack') {
          resolveBudgetIncident({ id, status: 'acknowledged', resolution: 'acknowledged' })
          // Every surface that renders this incident (badge, header bar,
          // other tabs) learns about it the same way it learned it opened.
          emitBudgetIncidentResolved({ incidentId: id, resolution: 'acknowledged' })
          ctx.activity.audit('budget.incident_resolved', 'system', { incidentId: id, action: 'ack' })
          return Response.json({ ok: true })
        }

        if (body.action === 'resume') {
          // S12: resuming while spend is still at/over the cap would just
          // re-breach on the next turn (and, on a defer rule, re-alert). Say
          // so — the honest way out is a raise.
          const rule = (readLimits().rules ?? []).find((r) => ruleMatchesIncident(r, incident))
          if (rule) {
            const facets = await assembleBudgetSpend(Date.now())
            const cap = capInUnit(rule, incident.window)
            if (cap !== null && ruleSpend(rule, facets, incident.window) >= cap) {
              return Response.json({ error: 'still_over_limit', message: 'Spend is still at or over this limit — raise the limit to resume.' }, { status: 409 })
            }
          }
          // `resumed` is REOPENABLE: spend went under, then over again is a
          // new event — a pause rule re-engages its hold instead of quietly
          // degrading to defer for the rest of the window.
          resolveBudgetIncident({ id, status: 'resolved', resolution: 'resumed' })
          emitBudgetIncidentResolved({ incidentId: id, resolution: 'resumed' })
          ctx.activity.audit('budget.incident_resolved', 'system', { incidentId: id, action: 'resume' })
          void import('../../../src/core/dispatch-cycle').then((m) => m.requestImmediateDispatch(`budget incident ${id} resumed`)).catch(() => {})
          return Response.json({ ok: true })
        }

        // raise
        if (typeof body.cap !== 'number') {
          return Response.json({ error: 'raise requires a cap (in the rule\'s unit: whole USD or tokens)' }, { status: 400 })
        }
        const cap = body.cap
        const preview = (readLimits().rules ?? []).find((r) => ruleMatchesIncident(r, incident))
        if (!preview) return Response.json({ error: 'The breached rule no longer exists — nothing to raise' }, { status: 400 })

        // The spend read is the await a concurrent PUT can land during, so
        // the rule is re-found INSIDE the serialized write turn below and the
        // new cap is applied to whatever list is current then.
        const facets = await assembleBudgetSpend(Date.now())
        const spentNow = ruleSpend(preview, facets, incident.window)
        const newCapValue = preview.lane === 'metered' ? Math.round(cap * 1_000_000) : Math.round(cap)
        if (newCapValue <= spentNow) {
          const spentHuman = preview.lane === 'metered' ? `$${(spentNow / 1_000_000).toFixed(2)}` : `${spentNow.toLocaleString()} tokens`
          return Response.json({ error: `New cap must exceed current ${incident.window} spend (${spentHuman})` }, { status: 400 })
        }

        const { result: applied } = await withSpendPolicyWrite<boolean>((current) => {
          const rules = current.limits.rules
          const live = rules.find((r) => ruleMatchesIncident(r as BudgetRule, incident))
          if (!live) return { next: current, result: false }
          const updated: StoredRule[] = rules.map((r) => (r === live ? { ...r, ...(incident.window === 'daily' ? { dailyCap: cap } : { monthlyCap: cap }) } : r))
          return { next: { ...current, limits: { ...current.limits, rules: updated } }, result: true }
        })
        if (!applied) return Response.json({ error: 'The breached rule was removed while raising — nothing to raise' }, { status: 409 })
        resolveBudgetIncident({ id, status: 'resolved', resolution: 'raised' })
        emitBudgetIncidentResolved({ incidentId: id, resolution: 'raised' })
        ctx.activity.audit('budget.incident_resolved', 'system', { incidentId: id, action: 'raise', cap, window: incident.window })
        observeAfterPolicyWrite('cap raised')
        // "Raise & resume" must RESUME — kick a dispatch cycle so deferred
        // tasks move now, not at the next interval.
        void import('../../../src/core/dispatch-cycle').then((m) => m.requestImmediateDispatch(`budget incident ${id} raised`)).catch(() => {})
        return Response.json({ ok: true })
      } catch (err) {
        return policyErrorResponse(err, 'POST /incidents/:id/resolve')
      }
    },
  }),

  defineRoute({
    path: '/milestones/:id/ack',
    method: 'POST',
    summary: 'Dismiss a milestone bar for its window',
    description: 'Marks the milestone row acknowledged; the header bar for it goes away until the next window. Never changes what is enforced.',
    params: z.object({ id: z.string().regex(/^\d+$/) }),
    body: { contentType: 'none' },
    responses: { 200: okResponse, 404: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params }) => {
      try {
        const id = Number(params.id)
        const ok = acknowledgeMilestone(id)
        if (!ok) return Response.json({ error: `No unacknowledged milestone ${id}` }, { status: 404 })
        ctx.activity.audit('budget.milestone_acknowledged', 'system', { milestoneId: id })
        // Reaches every browser (the header emits its own local copy for
        // the tab that clicked; other tabs and the nav badge need this one).
        emitSpendMilestoneAcknowledged(id)
        return Response.json({ ok: true })
      } catch (err) {
        return policyErrorResponse(err, 'POST /milestones/:id/ack')
      }
    },
  }),

  defineRoute({
    path: '/billing/overrides',
    method: 'PUT',
    summary: 'Replace billing-lane overrides',
    description: 'Manual lane assignments (metered vs subscription) that win over auth-profile detection — the fix when e.g. a Codex subscription reads as metered because its OAuth lives outside the per-agent auth profiles. Most-specific match wins: agent+provider, then agent, then provider. 422 when spend.json is invalid (nothing is written over it).',
    body: BillingOverridesSchema,
    responses: { 200: okResponse, 400: errorResponse, 422: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        await withSpendPolicyWrite((current) => ({ next: { ...current, billing: { overrides: body.overrides } }, result: null }))
        ctx.activity.audit('billing.overrides_updated', 'system', { overrides: body.overrides.length })
        observeAfterPolicyWrite('billing overrides updated')
        return Response.json({ ok: true })
      } catch (err) {
        return policyErrorResponse(err, 'PUT /billing/overrides')
      }
    },
  }),
]
