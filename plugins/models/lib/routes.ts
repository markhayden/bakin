/**
 * Models plugin REST routes (declarative).
 *
 * Extracted from index.ts. The catalog reads (/available, /refresh), config
 * reads/writes (/config, /defaults, /aliases), the routing + budget policy
 * settings surface, spend reporting off the execution ledger, and the runtime
 * restart-sync endpoints — assembled into one array the plugin shell registers
 * via `routes: modelsRoutes`. Handlers stay verbatim from the pre-split file;
 * shared state (models cache, restart-sync cell) is reached through its owning
 * lib module, never duplicated here.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { defineRoute } from '@bakin/core/routing'

import type { ModelsPluginSettings } from '../types'
import { KNOWN_PROVIDERS } from '@bakin/core/llm/model-catalog'
import {
  readPersistedCache,
  writePersistedCache,
} from './models-cache'
import { listRunCostsSince, listBudgetIncidents, resolveBudgetIncident, LedgerUnavailableError } from '../../../src/core/execution-ledger'
import { probeModels } from './probe'
import { buildSpendTimeline, rollupSpend } from './spend-rollup'
import { assembleBudgetSpend, paceProjection, dayEndMs, monthEndMs } from '../../../src/core/budget-spend'
import { budgetStatusRoutes } from './budget-routes'
import { describeSelections, getSelectionMutator } from './selections'
import { MutationRefused } from '../../../src/core/model-mutations'
import type { SelectionDocument } from '../../../src/core/model-selections'
import { AcknowledgePendingSchema } from './route-schemas'
import { isLegacyRouting, migrateLegacyRouting } from './routing-migration'
import { resolveAgents } from './config-io'
import { clearPendingRestart, describeRestart, notePendingChange, recordRestartFailure } from '../../../src/core/pending-restart'
import type { RuntimeConfigChangeKind } from '@bakin/core/adapters/runtime'
import { normalizeModelId } from '@bakin/core/llm/model-id'
import {
  applyEligibilityOverlay,
  fetchAvailableModels,
  loadConfiguredModelsFromRuntime,
  resetModelsCache,
  setModelsCache,
} from './available-models'
import { DEFAULT_ALIASES, readAliases } from './aliases'
import {
  BudgetPolicySchema,
  okResponse,
  errorResponse,
  passthrough,
  SPEND_WINDOW_MS,
  parseSpendWindow,
  MutateSelectionsSchema,
} from './route-schemas'

// ---------------------------------------------------------------------------
// Routes (declarative)
// ---------------------------------------------------------------------------
export const modelsRoutes = [
  defineRoute({
    path: '/available',
    method: 'GET',
    summary: 'List available models',
    description: 'Returns the model catalog from the configured runtime adapter with per-model eligibility. Cached on disk; the response signals freshness. `?agentId=<id>` judges eligibility under THAT agent\'s credentials (#907) — the scope an agent\'s own picker must use, and the scope the write path validates an agent pin under.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (req, ctx) => {
      try {
        const agentId = new URL(req.url).searchParams.get('agentId')?.trim() || undefined
        const result = await fetchAvailableModels(ctx as unknown as PluginContext, agentId ? { agentId } : {})
        return Response.json(result)
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/refresh',
    method: 'POST',
    summary: 'Refresh model list (bypass cache)',
    description: 'Forces a fresh fetch from the runtime adapter, bypassing both cache layers. Falls back to last-known-good cache on failure. `?probe=1` additionally fires a per-model account-callability probe (#852) — explicit requests only; the background auto-refresh path never probes.',
    body: { contentType: 'none' },
    responses: { 200: passthrough, 502: passthrough },
    handler: async (req, ctx) => {
      try {
        const models = await loadConfiguredModelsFromRuntime(ctx as unknown as PluginContext)
        const now = Date.now()
        // Caches persist the raw runtime snapshot; the response is overlaid
        // with live rejection state (#852) — never the other way around.
        setModelsCache({ models, fetchedAt: now })
        writePersistedCache({ models, fetchedAt: now, source: 'runtime' })
        // Probe AFTER the cache write and BEFORE the overlay, so probe
        // outcomes (resolve/open in the ledger) are reflected in this very
        // response's availability.
        const probeParam = new URL(req.url).searchParams.get('probe')
        const probeResult = probeParam === '1' || probeParam === 'true'
          // Runtime-unavailable rows (no auth for the provider) are now listed
          // too (#907) — probing them would bill a call that cannot succeed.
          ? await probeModels(ctx as unknown as PluginContext, models.filter((m) => m.available !== false))
          : null
        return Response.json({
          ok: true,
          models: await applyEligibilityOverlay(ctx as unknown as PluginContext, models),
          cached: false,
          cachedAt: now,
          stale: false,
          ...(probeResult ? { probe: probeResult } : {}),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const fallbackCache = readPersistedCache()
        if (fallbackCache) {
          return Response.json({
            ok: false,
            error: message,
            models: await applyEligibilityOverlay(ctx as unknown as PluginContext, fallbackCache.models),
            cached: true,
            cachedAt: fallbackCache.fetchedAt,
            stale: true,
          }, { status: 502 })
        }
        return Response.json({
          ok: false,
          error: message,
          models: [],
          cached: false,
          cachedAt: null,
          stale: false,
        }, { status: 502 })
      }
    },
  }),

  defineRoute({
    path: '/selections',
    method: 'GET',
    summary: 'Every persisted model selection with eligibility, proposals and pending writes',
    description: 'The inventory behind the Models page and Health (#907): each ref (runtime policy, agent pins, work-class routes, tag overrides, page mode) with its eligibility verdict, one revision over all of it, repair proposals for dead selections, and any adapter writes still pending.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        return Response.json(await describeSelections(ctx as unknown as PluginContext))
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/selections',
    method: 'POST',
    summary: 'Apply model-selection changes (the ONE write path)',
    description: 'Serialized, revision-checked mutation of persisted model selections. Refuses stale revisions (409), documents with a pending write (409), ineligible models (400, with a proposal) and knobs the runtime cannot persist (400). Writes are tri-state: applied, failed, or pending when the adapter has not settled within the deadline.',
    body: MutateSelectionsSchema,
    responses: { 200: passthrough, 400: errorResponse, 409: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        const result = await getSelectionMutator(ctx as unknown as PluginContext).mutate(body)
        if (result.applied.length > 0 || result.pending.length > 0) {
          // Post-write side effects: the adapter decides whether a restart is
          // needed per change kind (#878); the catalog's default/fallback
          // flags refresh; the config-changed hook fires for agent pins.
          const touched = [...result.applied, ...result.pending.map((p) => p.ref)]
          const kinds = new Set<RuntimeConfigChangeKind>()
          for (const ref of touched) {
            if (ref.startsWith('agent:')) kinds.add('model-config')
            else if (ref.startsWith('policy:')) kinds.add('routing-policy')
          }
          notePendingChange((ctx as unknown as PluginContext).runtime, [...kinds])
          setModelsCache(null)
          if (result.applied.some((ref) => ref.startsWith('agent:'))) {
            await ctx.hooks.invoke('models.configChanged', { refs: result.applied })
          }
        }
        return Response.json(result)
      } catch (err) {
        if (err instanceof MutationRefused) return Response.json(err.toBody(), { status: err.status })
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/holds',
    method: 'GET',
    summary: 'Todo tasks held because their effective model cannot run (#907)',
    description: 'Per-task holds computed with the SAME routing resolution + eligibility check the dispatch gate runs (route/tag → agent pin → runtime default). Independent of budget status so it works on installs with zero limits.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      const perTask: Record<string, { ref: string; model: string; detail: string }> = {}
      try {
        const [{ resolveDispatchRouting, modelHoldFor }, { readTaskboard }, { getRuntimeMainAgentId }, { loadDispatchState, getFailureRecord }, { getContentDir }, { resolveSystemRoute }] = await Promise.all([
          import('../../../src/core/dispatch-turns'),
          import('../../../src/core/task-store'),
          import('@bakin/core/adapters/runtime'),
          import('../../../src/core/dispatch-state'),
          import('../../../src/core/content-dir'),
          import('../../../src/core/system-route'),
        ])
        const runtime = (ctx as unknown as PluginContext).runtime
        const mainAgentId = await getRuntimeMainAgentId(runtime)
        const { columns } = readTaskboard()
        let failedDispatches: Record<string, unknown> = {}
        try {
          failedDispatches = loadDispatchState(getContentDir()).failedDispatches ?? {}
        } catch (err) {
          void err
        }
        for (const task of columns.todo ?? []) {
          // An UNRESOLVED team assignment is routed by the 'team-routing'
          // model (fired by the main agent) BEFORE the task's own model is
          // consulted — dispatch gates that first, so the board must too, or
          // a dead team-routing model skips the task with no hold to explain it.
          const { team, agent } = task as { team?: string; agent?: string }
          if (team && !agent) {
            const route = await resolveSystemRoute('team-routing')
            const teamHold = await modelHoldFor(mainAgentId, route.model ? { model: route.model, routeSource: route.source, workClass: 'team-routing' } : {}, runtime)
            if (teamHold && teamHold.reason === 'model_not_eligible') {
              perTask[task.id] = { ref: teamHold.ref, model: teamHold.model, detail: teamHold.detail }
              continue
            }
          }
          const agentId = task.agent ?? mainAgentId
          const isRecovery = Boolean(getFailureRecord(failedDispatches[task.id] as never)?.sessionDeath)
          const routing = await resolveDispatchRouting(task as never, isRecovery)
          const hold = await modelHoldFor(agentId, { model: routing.model, routeSource: routing.source, workClass: routing.workClass }, runtime)
          if (hold && hold.reason === 'model_not_eligible') perTask[task.id] = { ref: hold.ref, model: hold.model, detail: hold.detail }
        }
        return Response.json({ perTask })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err), perTask }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/selections/pending/acknowledge',
    method: 'POST',
    summary: 'Acknowledge a CONFLICTED pending write — frees its document',
    description: 'A pending write whose prior-boot re-read matched neither its previous nor its intended value is a CONFLICT (the document changed outside Bakin) and keeps its document reserved until the operator acknowledges it. Acknowledging drops the record; the current on-disk value stands and the document accepts writes again. 404 when the document has no conflicted write.',
    body: AcknowledgePendingSchema,
    responses: { 200: passthrough, 404: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        const mutator = getSelectionMutator(ctx as unknown as PluginContext)
        const conflict = (await mutator.reconcile()).pending.find((p) => p.document === body.document && p.state === 'conflict')
        if (!conflict) {
          return Response.json({ error: 'no_conflict', message: `${body.document} has no conflicted pending write to acknowledge` }, { status: 404 })
        }
        mutator.acknowledgeConflict(body.document as SelectionDocument)
        ctx.activity.audit('pending_write_acknowledged', 'system', { document: body.document, refs: conflict.refs })
        return Response.json({ ok: true, document: body.document, refs: conflict.refs, pending: (await mutator.reconcile()).pending })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/config',
    method: 'GET',
    summary: 'Get model config',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const [agents, policy] = await Promise.all([
          resolveAgents(ctx as unknown as PluginContext),
          ctx.runtime.models.routingPolicy(),
        ])
        return Response.json({
          agents,
          defaultModel: normalizeModelId(policy.defaultModel),
          defaultSubagentModel: policy.defaultSubagentModel
            ? normalizeModelId(policy.defaultSubagentModel)
            : null,
          fallbackModels: policy.fallbackModels.map(normalizeModelId),
          // Which routing knobs the ACTIVE runtime honors — UIs hide the rest.
          support: ctx.runtime.models.routingSupport(),
        })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/aliases',
    method: 'GET',
    summary: 'List model aliases',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const policy = await ctx.runtime.models.routingPolicy()
        return Response.json({ aliases: readAliases(policy.aliases) })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/aliases/recommended',
    method: 'GET',
    summary: 'Recommended alias set (data for the one write path)',
    description: 'The curated DEFAULT_ALIASES map. Read-only: the client merges it with the current aliases and writes through POST /selections.',
    responses: { 200: passthrough },
    handler: async () => Response.json({ aliases: DEFAULT_ALIASES }),
  }),

  defineRoute({
    path: '/routing',
    method: 'GET',
    summary: 'Per-turn model/thinking routing policy',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const routing = ctx.getSettings<ModelsPluginSettings>().routing
        // Read-guard mirrors models.getRoutingConfig: legacy shapes migrate
        // on read rather than reading as unset.
        if (isLegacyRouting(routing)) return Response.json(migrateLegacyRouting(routing))
        return Response.json(routing ?? { routes: [], tagOverrides: [] })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/routing/recommend',
    method: 'GET',
    summary: 'Compute recommended cheap-model routes for unrouted system classes',
    description: 'Proposal list only — nothing is written. The UI shows the diff in a ConfirmDialog; confirming PUTs the routes.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const { buildRoutingHealthDeps, recommendRoutes } = await import('./health-checks')
        const deps = buildRoutingHealthDeps(ctx as unknown as PluginContext, {
          readRoutingConfig: () => {
            const stored = ctx.getSettings<ModelsPluginSettings>().routing
            if (isLegacyRouting(stored)) return migrateLegacyRouting(stored)
            return stored ?? { routes: [], tagOverrides: [] }
          },
          listAvailableModels: async () => (await fetchAvailableModels(ctx as unknown as PluginContext)).models,
          listRunCostsSince: (sinceMs) => listRunCostsSince(sinceMs),
        })
        return Response.json(await recommendRoutes(deps))
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/budget',
    method: 'GET',
    summary: 'Spend-cap policy',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        return Response.json(ctx.getSettings<ModelsPluginSettings>().budget ?? {})
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/budget',
    method: 'PUT',
    summary: 'Replace the budget policy',
    body: BudgetPolicySchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        // Model-scoped rule ids normalize on write so they key identically
        // to the normalized model ids on spend rows.
        const rules = (body.rules ?? []).map((r) =>
          r.scope === 'model' && r.scopeId ? { ...r, scopeId: normalizeModelId(r.scopeId) } : r,
        )
        ;(ctx as unknown as PluginContext).updateSettings({ budget: { rules } })
        // Live incidents whose rule was just deleted would otherwise strand
        // in the banner with no working action — resolve them now.
        try {
          for (const incident of listBudgetIncidents({ openOnly: true })) {
            const stillExists = rules.some(
              (r) => r.scope === incident.scope && (r.scopeId ?? '') === incident.scopeId && r.lane === incident.lane,
            )
            if (!stillExists) resolveBudgetIncident({ id: incident.id, status: 'resolved', resolution: 'rule_removed' })
          }
        } catch (err) {
          // Cleanup is best-effort — a failed sweep must not fail the save.
          void err
        }
        // Unknown scope ids are the #1 fake-safety trap (a typo'd agent id
        // caps nothing) — warn, don't reject (the id may exist later).
        const warnings: string[] = []
        try {
          const knownAgents = new Set((await resolveAgents(ctx as unknown as PluginContext)).map((a) => a.agentId))
          const knownProviders = new Set(KNOWN_PROVIDERS.map((p) => p.id))
          for (const r of rules) {
            if (r.scope === 'agent' && r.scopeId && !knownAgents.has(r.scopeId)) {
              warnings.push(`No agent named '${r.scopeId}' — this rule caps nothing until such an agent exists.`)
            }
            if (r.scope === 'provider' && r.scopeId && !knownProviders.has(r.scopeId)) {
              warnings.push(`Unknown provider '${r.scopeId}' — this rule caps nothing (known: ${KNOWN_PROVIDERS.map((p) => p.id).join(', ')}).`)
            }
          }
        } catch (err) {
          void err // runtime unreachable — skip validation, never block the save
        }
        ctx.activity.audit('budget.updated', 'system', { rules: rules.length, warnings: warnings.length })
        ctx.activity.log('system', 'Updated budget policy', { category: 'models' })
        return Response.json({ ok: true, ...(warnings.length ? { warnings } : {}) })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/spend',
    method: 'GET',
    summary: 'Estimated agent spend over a window',
    description: 'Windowed token/cost rollups from the execution ledger (total, by agent, by model). Costs are estimates — cache-token rates default to a fixed multiple of input where a model does not declare exact rates.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (req) => {
      try {
        const window = parseSpendWindow(new URL(req.url).searchParams.get('window'))
        const now = Date.now()
        const sinceMs = window === 'all' ? 0 : now - SPEND_WINDOW_MS[window]
        // NULL-honest rollups over raw rows (replaced the ledger GROUP-BY
        // verbs whose COALESCE fabricated $0 for unpriced buckets).
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
        // A reporting read must not crash the page when the ledger is down.
        if (err instanceof LedgerUnavailableError) {
          return Response.json({ error: 'Spend ledger unavailable', totalUsdMicros: 0, byAgent: [], byModel: [], byWorkClass: [] }, { status: 500 })
        }
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/runtime/status',
    method: 'GET',
    summary: 'Pending runtime restart, in the adapter\'s words',
    description: 'Whether a config change is still waiting on a runtime restart (#878). The text and action come from the adapter\'s restartAdvice(); adapters without it get a generic fallback. Cleared only by a successful restart.',
    responses: { 200: passthrough },
    handler: async (_req, ctx) => Response.json(describeRestart((ctx as unknown as PluginContext).runtime)),
  }),

  defineRoute({
    path: '/runtime/restart',
    method: 'POST',
    summary: 'Restart the runtime',
    body: { contentType: 'none' },
    responses: { 200: okResponse, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        await (ctx as unknown as PluginContext).runtime.restart()
        clearPendingRestart()
        resetModelsCache()
        ctx.activity.audit('runtime.restarted', 'system')
        ctx.activity.log('system', 'Runtime restarted', { category: 'models' })
        return Response.json({ ok: true, message: 'Restart initiated' })
      } catch (err) {
        // The banner stays (and says why) — a failed restart never clears it.
        recordRestartFailure(err)
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  // Budget status + incident routes (cost-control v2) — see budget-routes.ts.
  ...budgetStatusRoutes,
]
