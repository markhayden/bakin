/**
 * Budget status + incident routes (cost-control v2, #464).
 *
 * /budget/status is the lightweight poll the Tasks UI (deferred badges) and
 * the host shell (kill-switch banner) share — a SIDE-EFFECT-FREE view of
 * "would a dispatch defer right now": it evaluates the same rules over the
 * same engine facets the gate uses but never opens incidents or audits.
 * /budget/incidents lists the durable breach records; the resolve action is
 * the paperclip-style human loop — raise the cap (validated above current
 * spend, in the rule's unit) & resume, acknowledge (stop alerting, keep
 * deferring), or resume (clear a pause without raising).
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { defineRoute } from '@bakin/core/routing'
import { z } from 'zod'

import type { ModelsPluginSettings } from '../types'
import { resolveBilling } from './billing'
import { normalizeModelId } from './model-id'
import { isLegacyBudget, migrateLegacyBudget } from './budget-migration'
import { resolveAgents } from './config-io'
import {
  listBudgetIncidents,
  resolveBudgetIncident,
  resolveExpiredBudgetIncidents,
  findOpenCapIncident,
  LedgerUnavailableError,
  type BudgetIncidentRow,
} from '../../../src/core/execution-ledger'
import { assembleBudgetSpend, type BudgetSpendFacets, type LaneSums, type ScopeSpend } from '../../../src/core/budget-spend'
import { evaluateBudget, dayStartMs, monthStartMs, type BudgetPolicy, type BudgetRule } from '../../../src/core/budget'
import { getSettings as getSystemSettings } from '../../../src/core/settings'
import { emitBudgetIncidentResolved } from '../../../src/core/budget-notify'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('models:budget-routes')

const passthrough = z.record(z.string(), z.unknown())
const errorResponse = z.object({ error: z.string() })
const okResponse = z.object({ ok: z.boolean() })

export type AgentBudgetStatus = 'ok' | 'warn' | 'deferred'

function rulesOf(ctx: { getSettings<T>(): T }): BudgetRule[] {
  // Same migrate-on-read the getBudgetPolicy hook does — a legacy-shaped
  // settings file must read consistently on EVERY surface, not just the gate.
  const budget = ctx.getSettings<ModelsPluginSettings>().budget
  if (isLegacyBudget(budget)) return migrateLegacyBudget(budget).rules ?? []
  return (budget as BudgetPolicy | undefined)?.rules ?? []
}

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
  return decision.action === 'defer' ? 'deferred' : decision.action === 'warn' ? 'warn' : 'ok'
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

const ResolveIncidentSchema = z.object({
  action: z.enum(['raise', 'ack', 'resume']),
  /** New cap for 'raise', in the rule's unit (whole USD or tokens). */
  cap: z.number().positive().optional(),
})

const BillingOverridesSchema = z.object({
  overrides: z.array(
    z
      .object({
        agentId: z.string().min(1).optional(),
        provider: z.string().min(1).optional(),
        lane: z.enum(['metered', 'subscription']),
      })
      .refine((o) => o.agentId !== undefined || o.provider !== undefined, {
        message: 'an override needs an agentId, a provider, or both',
      }),
  ),
})

export const budgetStatusRoutes = [
  defineRoute({
    path: '/budget/status',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Live budget gate status (side-effect-free)',
    description: 'Kill-switch state, per-agent gate status (ok | warn | deferred), providers currently deferred by provider rules, and open incidents — the poll behind task badges and the pause banner. Never opens incidents or audits.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (req, ctx) => {
      try {
        const paused = getSystemSettings().dispatch.paused
        // ?lite=1 — the header banner's poll wants ONLY the kill-switch bit;
        // skip the facets/agents work entirely.
        if (new URL(req.url).searchParams.get('lite') === '1') {
          return Response.json({ paused })
        }
        // Maintenance-on-read (same as GET /budget/incidents): a quiet board
        // must not report rolled-over defer incidents as live.
        try {
          const sweepNow = Date.now()
          resolveExpiredBudgetIncidents({ dailyWindowStartMs: dayStartMs(sweepNow), monthlyWindowStartMs: monthStartMs(sweepNow), now: sweepNow })
        } catch (err) {
          void err
        }
        const policy: BudgetPolicy = { rules: rulesOf(ctx) }
        const openIncidents = listBudgetIncidents({ openOnly: true })
        if (!policy.rules?.length) {
          const billing: Record<string, { provider: string; lane: 'metered' | 'subscription'; model: string | null }> = {}
          try {
            for (const agent of await resolveAgents(ctx as unknown as PluginContext)) {
              const agentBilling = await resolveBilling(ctx as unknown as PluginContext, { agentId: agent.agentId, model: agent.effectiveModel })
              billing[agent.agentId] = { ...agentBilling, model: agent.effectiveModel }
            }
          } catch (err) {
            void err // runtime unreachable — lane card degrades
          }
          return Response.json({ paused, configured: false, perAgent: {}, perTask: {}, billing, overrides: ctx.getSettings<ModelsPluginSettings>().billing?.overrides ?? [], deferredProviders: [], openIncidents })
        }
        const facets = await assembleBudgetSpend(Date.now())
        // Runtime-config reads can fail (runtime down / not installed) —
        // status degrades to global/provider info rather than 500ing.
        let agents: Awaited<ReturnType<typeof resolveAgents>> = []
        try {
          agents = await resolveAgents(ctx as unknown as PluginContext)
        } catch {
          agents = []
        }
        const perAgent: Record<string, AgentBudgetStatus> = {}
        const billing: Record<string, { provider: string; lane: 'metered' | 'subscription'; model: string | null }> = {}
        const effectiveModelByAgent = new Map<string, string | null>()
        for (const agent of agents) {
          effectiveModelByAgent.set(agent.agentId, agent.effectiveModel)
          perAgent[agent.agentId] = await gateStatusFor(ctx as unknown as PluginContext, policy, facets, agent.agentId, agent.effectiveModel)
          // Detected billing lane per agent (its default model's provider) —
          // the Spend tab's "why does my Codex agent read as metered?" answer.
          const agentBilling = await resolveBilling(ctx as unknown as PluginContext, { agentId: agent.agentId, model: agent.effectiveModel })
          billing[agent.agentId] = { ...agentBilling, model: agent.effectiveModel }
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
          // graph) out of the models plugin's static imports.
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
          // must evaluate the same model the gate will (dispatch-cycle passes
          // !!failure?.sessionDeath).
          let failedDispatches: Record<string, unknown> = {}
          try {
            failedDispatches = loadDispatchState(getContentDir()).failedDispatches ?? {}
          } catch (err) {
            void err
          }
          for (const task of columns.todo ?? []) {
            const agentId = task.agent ?? mainAgentId
            const isRecovery = Boolean(getFailureRecord(failedDispatches[task.id] as never)?.sessionDeath)
            let routedModel: string | null = null
            try {
              const routing = await resolveDispatchRouting(task as never, isRecovery)
              routedModel = routing.model ?? null
            } catch (err) {
              void err // inherit the agent default below
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
        return Response.json({ paused, configured: true, perAgent, perTask, billing, overrides: ctx.getSettings<ModelsPluginSettings>().billing?.overrides ?? [], deferredProviders: [...new Set(deferredProviders)], openIncidents })
      } catch (err) {
        const status = err instanceof LedgerUnavailableError ? 503 : 500
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status })
      }
    },
  }),

  defineRoute({
    path: '/budget/incidents',
    method: 'GET',
    summary: 'Budget incidents (durable breach records)',
    description: 'Open (live) incidents by default; ?all=1 includes resolved history.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (req) => {
      try {
        // Maintenance-on-read: a quiet board (no dispatch attempts) must not
        // show yesterday's rolled-over defer incidents as live forever.
        const now = Date.now()
        try {
          resolveExpiredBudgetIncidents({ dailyWindowStartMs: dayStartMs(now), monthlyWindowStartMs: monthStartMs(now), now })
        } catch (err) {
          void err // listing still works; the gate sweeps on its next pass
        }
        const all = new URL(req.url).searchParams.get('all') === '1'
        return Response.json({ incidents: listBudgetIncidents(all ? {} : { openOnly: true }) })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/budget/incidents/:id/resolve',
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
        const rules = rulesOf(ctx)
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
        ;(ctx as unknown as PluginContext).updateSettings({ budget: { rules: updated } })
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
        ;(ctx as unknown as PluginContext).updateSettings({ billing: { overrides: body.overrides } })
        ctx.activity.audit('billing.overrides_updated', 'system', { overrides: body.overrides.length })
        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),
]
