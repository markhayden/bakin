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
import { resolveAgents } from './config-io'
import {
  listBudgetIncidents,
  resolveBudgetIncident,
  findOpenCapIncident,
  LedgerUnavailableError,
  type BudgetIncidentRow,
} from '../../../src/core/execution-ledger'
import { assembleBudgetSpend, type BudgetSpendFacets, type LaneSums, type ScopeSpend } from '../../../src/core/budget-spend'
import { evaluateBudget, type BudgetPolicy, type BudgetRule } from '../../../src/core/budget'
import { getSettings as getSystemSettings } from '../../../src/core/settings'
import { emitBudgetIncidentResolved } from '../../../src/core/budget-notify'

const passthrough = z.record(z.string(), z.unknown())
const errorResponse = z.object({ error: z.string() })
const okResponse = z.object({ ok: z.boolean() })

export type AgentBudgetStatus = 'ok' | 'warn' | 'deferred'

function rulesOf(ctx: { getSettings<T>(): T }): BudgetRule[] {
  return (ctx.getSettings<ModelsPluginSettings>().budget as BudgetPolicy | undefined)?.rules ?? []
}

/** Worst decision for an agent across both lanes (its own billing context). */
async function agentStatus(
  ctx: PluginContext,
  policy: BudgetPolicy,
  facets: BudgetSpendFacets,
  agentId: string,
  effectiveModel: string | null,
): Promise<AgentBudgetStatus> {
  const billing = await resolveBilling(ctx, { agentId, model: effectiveModel })
  // Pause-mode incidents block regardless of current spend — mirror the gate.
  for (const rule of policy.rules ?? []) {
    if (rule.atCap !== 'pause') continue
    const matches =
      rule.lane === billing.lane &&
      (rule.scope === 'global' ||
        (rule.scope === 'agent' && rule.scopeId === agentId) ||
        (rule.scope === 'provider' && rule.scopeId === billing.provider) ||
        (rule.scope === 'model' && rule.scopeId === (effectiveModel ?? undefined)))
    if (matches && findOpenCapIncident({ scope: rule.scope, scopeId: rule.scopeId, lane: rule.lane })) return 'deferred'
  }
  const decision = evaluateBudget({
    policy,
    turn: { agent: agentId, provider: billing.provider, model: effectiveModel ?? undefined, lane: billing.lane },
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

export const budgetStatusRoutes = [
  defineRoute({
    path: '/budget/status',
    method: 'GET',
    summary: 'Live budget gate status (side-effect-free)',
    description: 'Kill-switch state, per-agent gate status (ok | warn | deferred), providers currently deferred by provider rules, and open incidents — the poll behind task badges and the pause banner. Never opens incidents or audits.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const paused = getSystemSettings().dispatch.paused
        const policy: BudgetPolicy = { rules: rulesOf(ctx) }
        const openIncidents = listBudgetIncidents({ openOnly: true })
        if (!policy.rules?.length) {
          return Response.json({ paused, configured: false, perAgent: {}, deferredProviders: [], openIncidents })
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
        for (const agent of agents) {
          perAgent[agent.agentId] = await agentStatus(ctx as unknown as PluginContext, policy, facets, agent.agentId, agent.effectiveModel)
        }
        const deferredProviders = (policy.rules ?? [])
          .filter((r) => r.scope === 'provider' && r.scopeId)
          .filter((r) =>
            evaluateBudget({ policy: { rules: [r] }, turn: { agent: '', provider: r.scopeId, lane: r.lane }, facets }).action === 'defer' ||
            (r.atCap === 'pause' && findOpenCapIncident({ scope: 'provider', scopeId: r.scopeId, lane: r.lane }) !== null),
          )
          .map((r) => r.scopeId as string)
        return Response.json({ paused, configured: true, perAgent, deferredProviders: [...new Set(deferredProviders)], openIncidents })
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
          return Response.json({ ok: true })
        }

        // raise
        if (typeof body.cap !== 'number') {
          return Response.json({ error: 'raise requires a cap (in the rule\'s unit: whole USD or tokens)' }, { status: 400 })
        }
        const settings = ctx.getSettings<ModelsPluginSettings>()
        const rules = (settings.budget as BudgetPolicy | undefined)?.rules ?? []
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
        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),
]
