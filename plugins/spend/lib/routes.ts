/**
 * Spend plugin REST routes (declarative).
 *
 *   GET  /spend                    windowed rollups + cap-window facets + pace
 *   GET  /coverage                 observed-days coverage + the limit suggestion (D27)
 *   GET  /limits                   the limits policy (rules with ids)
 *   PUT  /limits                   replace the rule list (ids server-assigned)
 *   GET  /status[?lite=1]          live gate status — the poll behind badges/banner
 *   GET  /incidents[?all=1]        durable breach records
 *   POST /incidents/:id/resolve    raise | ack | resume
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
  findOpenCapIncident,
  listBudgetIncidents,
  listRunCostsSince,
  resolveBudgetIncident,
  resolveExpiredBudgetIncidents,
  LedgerUnavailableError,
  type BudgetIncidentRow,
} from '../../../src/core/execution-ledger'
import { assembleBudgetSpend, paceProjection, dayEndMs, monthEndMs, type BudgetSpendFacets, type LaneSums, type ScopeSpend } from '../../../src/core/budget-spend'
import { evaluateBudget, dayStartMs, monthStartMs, type BudgetPolicy, type BudgetRule } from '../../../src/core/budget'
import { buildSpendTimeline, rollupSpend } from '../../../src/core/spend-rollup'
import { getSettings as getSystemSettings } from '../../../src/core/settings'
import { emitBudgetIncidentResolved } from '../../../src/core/budget-notify'
import { createLogger } from '../../../src/core/logger'
import { resolveBilling } from './billing'
import { coverageSummary, suggestMonthlyLimit } from './coverage'
import { BillingOverridesSchema, LimitsSchema, readLimits, readOverrides, SpendSettingsSchema } from './settings'

const log = createLogger('spend:routes')

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

function writeLimits(ctx: PluginContext, limits: z.infer<typeof LimitsSchema>): void {
  const current = SpendSettingsSchema.safeParse(ctx.getSettings<unknown>())
  ctx.updateSettings({ limits, billing: current.success ? current.data.billing : { overrides: [] } })
}

const ResolveIncidentSchema = z.object({
  action: z.enum(['raise', 'ack', 'resume']),
  /** New cap for 'raise', in the rule's unit (whole USD or tokens). */
  cap: z.number().positive().optional(),
})

/** PUT /limits body: the same rule shape, id optional (assigned on save). */
const PutLimitsSchema = z.object({
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
  ),
})

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
        })
      } catch (err) {
        if (err instanceof LedgerUnavailableError) {
          return Response.json({ error: 'Spend ledger unavailable' }, { status: 503 })
        }
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
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
        if (err instanceof LedgerUnavailableError) return Response.json({ error: 'Spend ledger unavailable' }, { status: 503 })
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/limits',
    method: 'GET',
    summary: 'Spend limits policy',
    description: 'The rule list dispatch consults (each rule carries its server-assigned id) and the accept-unattributed cutoff.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        return Response.json(readLimits(ctx))
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/limits',
    method: 'PUT',
    summary: 'Replace the spend limits',
    description: 'Every rule round-trips; ids are kept when present and assigned when absent (a rule with a fresh id starts its milestone ladder fresh). Incidents of deleted rules resolve rule_removed. Unknown scope ids warn (a typo caps nothing) but never block the save.',
    body: PutLimitsSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        const previous = readLimits(ctx)
        // Model-scoped rule ids normalize on write so they key identically
        // to the normalized model ids on spend rows.
        const rules = body.rules.map((r) => ({
          ...r,
          id: r.id ?? randomUUID(),
          ...(r.scope === 'model' && r.scopeId ? { scopeId: normalizeModelId(r.scopeId) } : {}),
        }))
        const limits = LimitsSchema.parse({
          rules,
          ...(previous.acceptUnattributedBefore ? { acceptUnattributedBefore: previous.acceptUnattributedBefore } : {}),
        })
        writeLimits(ctx as unknown as PluginContext, limits)
        // Live incidents whose rule was just deleted would otherwise strand
        // in the banner with no working action — resolve them now.
        try {
          for (const incident of listBudgetIncidents({ openOnly: true })) {
            if (!rules.some((r) => ruleMatchesIncident(r as BudgetRule, incident))) {
              resolveBudgetIncident({ id: incident.id, status: 'resolved', resolution: 'rule_removed' })
            }
          }
        } catch (err) {
          log.warn('could not resolve incidents of removed rules', { err: err instanceof Error ? err.message : String(err) })
        }
        // Unknown scope ids are the #1 fake-safety trap (a typo'd agent id
        // caps nothing) — warn, don't reject (the id may exist later).
        const warnings: string[] = []
        const knownAgents = new Set((await listAgentModels(ctx as unknown as PluginContext)).map((a) => a.agentId))
        const knownProviders = new Set(KNOWN_PROVIDERS.map((p) => p.id))
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
        return Response.json({ ok: true, ...(warnings.length ? { warnings } : {}) })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
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
        if (new URL(req.url).searchParams.get('lite') === '1') {
          return Response.json({ paused })
        }
        sweepRollover()
        const policy = readLimits(ctx)
        const overrides = readOverrides(ctx)
        const openIncidents = listBudgetIncidents({ openOnly: true })
        const agents = await listAgentModels(ctx as unknown as PluginContext)
        const billing: Record<string, { provider: string; lane: 'metered' | 'subscription'; model: string | null }> = {}
        for (const agent of agents) {
          const agentBilling = await resolveBilling(ctx as unknown as PluginContext, { agentId: agent.agentId, model: agent.effectiveModel })
          billing[agent.agentId] = { ...agentBilling, model: agent.effectiveModel }
        }
        if (!policy.rules?.length) {
          return Response.json({ paused, configured: false, perAgent: {}, perTask: {}, billing, overrides, deferredProviders: [], openIncidents })
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
        return Response.json({ paused, configured: true, perAgent, perTask, billing, overrides, deferredProviders: [...new Set(deferredProviders)], openIncidents })
      } catch (err) {
        const status = err instanceof LedgerUnavailableError ? 503 : 500
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status })
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
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
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
    responses: { 200: okResponse, 400: errorResponse, 404: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      try {
        const id = Number(params.id)
        const incident = listBudgetIncidents({}).find((i) => i.id === id)
        if (!incident) return Response.json({ error: `No incident ${id}` }, { status: 404 })
        if (incident.status === 'resolved') return Response.json({ error: `Incident ${id} is already resolved` }, { status: 400 })

        if (body.action === 'ack') {
          resolveBudgetIncident({ id, status: 'acknowledged', resolution: 'acknowledged' })
          ctx.activity.audit('budget.incident_resolved', 'system', { incidentId: id, action: 'ack' })
          return Response.json({ ok: true })
        }

        if (body.action === 'resume') {
          resolveBudgetIncident({ id, status: 'resolved', resolution: 'acknowledged' })
          emitBudgetIncidentResolved({ incidentId: id, resolution: 'acknowledged' })
          ctx.activity.audit('budget.incident_resolved', 'system', { incidentId: id, action: 'resume' })
          void import('../../../src/core/dispatch-cycle').then((m) => m.requestImmediateDispatch(`budget incident ${id} resumed`)).catch(() => {})
          return Response.json({ ok: true })
        }

        // raise
        if (typeof body.cap !== 'number') {
          return Response.json({ error: 'raise requires a cap (in the rule\'s unit: whole USD or tokens)' }, { status: 400 })
        }
        const limits = readLimits(ctx)
        const rules = limits.rules ?? []
        const rule = rules.find((r) => ruleMatchesIncident(r, incident))
        if (!rule) return Response.json({ error: 'The breached rule no longer exists — nothing to raise' }, { status: 400 })

        const facets = await assembleBudgetSpend(Date.now())
        const spentNow = ruleSpend(rule, facets, incident.window)
        const newCapValue = rule.lane === 'metered' ? Math.round(body.cap * 1_000_000) : Math.round(body.cap)
        if (newCapValue <= spentNow) {
          const spentHuman = rule.lane === 'metered' ? `$${(spentNow / 1_000_000).toFixed(2)}` : `${spentNow.toLocaleString()} tokens`
          return Response.json({ error: `New cap must exceed current ${incident.window} spend (${spentHuman})` }, { status: 400 })
        }

        const updated = rules.map((r) =>
          r === rule ? { ...r, ...(incident.window === 'daily' ? { dailyCap: body.cap } : { monthlyCap: body.cap }) } : r,
        )
        writeLimits(ctx as unknown as PluginContext, LimitsSchema.parse({ ...limits, rules: updated }))
        resolveBudgetIncident({ id, status: 'resolved', resolution: 'raised' })
        emitBudgetIncidentResolved({ incidentId: id, resolution: 'raised' })
        ctx.activity.audit('budget.incident_resolved', 'system', { incidentId: id, action: 'raise', cap: body.cap, window: incident.window })
        // "Raise & resume" must RESUME — kick a dispatch cycle so deferred
        // tasks move now, not at the next interval.
        void import('../../../src/core/dispatch-cycle').then((m) => m.requestImmediateDispatch(`budget incident ${id} raised`)).catch(() => {})
        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/billing/overrides',
    method: 'PUT',
    summary: 'Replace billing-lane overrides',
    description: 'Manual lane assignments (metered vs subscription) that win over auth-profile detection — the fix when e.g. a Codex subscription reads as metered because its OAuth lives outside the per-agent auth profiles. Most-specific match wins: agent+provider, then agent, then provider.',
    body: BillingOverridesSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        const limits = readLimits(ctx)
        ;(ctx as unknown as PluginContext).updateSettings({ limits, billing: { overrides: body.overrides } })
        ctx.activity.audit('billing.overrides_updated', 'system', { overrides: body.overrides.length })
        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),
]
