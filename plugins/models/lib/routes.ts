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
import {
  readPersistedCache,
  writePersistedCache,
  clearPersistedCache,
} from './models-cache'
import { spendTotal, spendByAgent, spendByModel, LedgerUnavailableError } from '../../../src/core/execution-ledger'
import {
  getRuntimeSync,
  markConfigDirty,
  markRuntimeRestarted,
  resolveAgents,
} from './config-io'
import { normalizeModelId } from './model-id'
import {
  fetchAvailableModels,
  loadConfiguredModelsFromRuntime,
  setModelsCache,
} from './available-models'
import { DEFAULT_ALIASES, readAliases } from './aliases'
import {
  ConfigUpdateSchema,
  DefaultsUpdateSchema,
  AliasActionSchema,
  RoutingConfigSchema,
  BudgetPolicySchema,
  okResponse,
  errorResponse,
  passthrough,
  SPEND_WINDOW_MS,
  parseSpendWindow,
} from './route-schemas'

// ---------------------------------------------------------------------------
// Routes (declarative)
// ---------------------------------------------------------------------------
export const modelsRoutes = [
  defineRoute({
    path: '/available',
    method: 'GET',
    summary: 'List available models',
    description: 'Returns the model catalog from the configured runtime adapter. Cached on disk; the response signals freshness.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const result = await fetchAvailableModels(ctx as unknown as PluginContext)
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
    description: 'Forces a fresh fetch from the runtime adapter, bypassing both cache layers. Falls back to last-known-good cache on failure.',
    body: { contentType: 'none' },
    responses: { 200: passthrough, 502: passthrough },
    handler: async (_req, ctx) => {
      try {
        const models = await loadConfiguredModelsFromRuntime(ctx as unknown as PluginContext)
        const now = Date.now()
        setModelsCache({ models, fetchedAt: now })
        writePersistedCache({ models, fetchedAt: now, source: 'runtime' })
        return Response.json({ ok: true, models, cached: false, cachedAt: now, stale: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const fallbackCache = readPersistedCache()
        if (fallbackCache) {
          return Response.json({
            ok: false,
            error: message,
            models: fallbackCache.models,
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
    path: '/config',
    method: 'POST',
    summary: 'Update agent model config',
    body: ConfigUpdateSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        const { agentId } = body
        const agentsBefore = await resolveAgents(ctx as unknown as PluginContext)
        const before = agentsBefore.find((a) => a.agentId === agentId)
        if (!before) throw new Error(`Agent "${agentId}" not found`)
        const oldModel = before?.effectiveModel ?? null

        // Per-agent assignments are runtime-owned (P2.3): write through
        // agents.update — empty string clears (null), never a config edit.
        await ctx.runtime.agents.update(agentId, {
          ...(body.ownModel !== undefined
            ? { model: body.ownModel ? normalizeModelId(body.ownModel) : null }
            : {}),
          ...(body.subagentModel !== undefined
            ? { subagentModel: body.subagentModel ? normalizeModelId(body.subagentModel) : null }
            : {}),
        })

        const agentsAfter = await resolveAgents(ctx as unknown as PluginContext)
        const after = agentsAfter.find((a) => a.agentId === agentId)
        const newModel = after?.effectiveModel ?? null

        markConfigDirty()
        setModelsCache(null)
        ctx.activity.audit('config.updated', 'system', { agentId, ownModel: body.ownModel, subagentModel: body.subagentModel })
        ctx.activity.log('system', `Updated model config for ${agentId}`, { category: 'models' })

        if (oldModel !== newModel) {
          try { await ctx.hooks.invoke('models.configChanged', { agentId, oldModel, newModel }) } catch { /* no subscribers */ }
        }

        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/defaults',
    method: 'POST',
    summary: 'Update default models',
    body: DefaultsUpdateSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        // Routing policy is runtime-owned (P2.3): merge through the neutral
        // surface; the adapter maps to its native store (and rejects fields
        // it declares unsupported).
        const currentPolicy = await ctx.runtime.models.routingPolicy()
        const nextDefault = body.defaultModel
          ? normalizeModelId(body.defaultModel)
          : normalizeModelId(currentPolicy.defaultModel)
        await ctx.runtime.models.setRoutingPolicy({
          ...(body.defaultModel ? { defaultModel: normalizeModelId(body.defaultModel) } : {}),
          ...(body.fallbackModels
            ? { fallbackModels: [...new Set(body.fallbackModels.map(normalizeModelId).filter((id) => id !== nextDefault))] }
            : {}),
          ...(body.defaultSubagentModel !== undefined
            ? { defaultSubagentModel: body.defaultSubagentModel || null }
            : {}),
        }, 'models.update-defaults')

        markConfigDirty()
        setModelsCache(null)
        ctx.activity.audit('defaults.updated', 'system', { defaultModel: body.defaultModel, defaultSubagentModel: body.defaultSubagentModel, fallbackModels: body.fallbackModels })
        ctx.activity.log('system', `Updated model defaults${body.defaultModel ? ` to ${body.defaultModel}` : ''}`, { category: 'models' })
        return Response.json({ ok: true })
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
    path: '/aliases',
    method: 'POST',
    summary: 'Add/delete/prepopulate model aliases',
    body: AliasActionSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        // Aliases are runtime-owned policy (P2.3): compute the next full map
        // from the current one, write through the neutral surface.
        const currentAliases = readAliases((await ctx.runtime.models.routingPolicy()).aliases)
        let nextAliases: Record<string, string> = { ...currentAliases }
        if ('aliases' in body) {
          nextAliases = Object.fromEntries(
            Object.entries(body.aliases).map(([alias, target]) => [alias, normalizeModelId(target)]),
          )
        } else if ('action' in body) {
          if (body.action === 'add') {
            nextAliases[body.name] = normalizeModelId(body.target)
          } else if (body.action === 'delete') {
            delete nextAliases[body.name]
          } else if (body.action === 'prepopulate') {
            for (const [alias, target] of Object.entries(DEFAULT_ALIASES)) {
              if (!(alias in nextAliases)) nextAliases[alias] = target
            }
          }
        }
        await ctx.runtime.models.setRoutingPolicy({ aliases: nextAliases }, 'models.update-aliases')

        setModelsCache(null)
        ctx.activity.audit('aliases.updated', 'system')
        ctx.activity.log('system', 'Updated model aliases', { category: 'models' })
        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/routing',
    method: 'GET',
    summary: 'Per-turn model/thinking routing policy',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (_req, ctx) => {
      try {
        const settings = ctx.getSettings<ModelsPluginSettings>()
        return Response.json(settings.routing ?? { policies: [], tagOverrides: [] })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/routing',
    method: 'PUT',
    summary: 'Replace the routing policy',
    body: RoutingConfigSchema,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        (ctx as unknown as PluginContext).updateSettings({ routing: body })
        ctx.activity.audit('routing.updated', 'system', { policies: body.policies.length, tagOverrides: body.tagOverrides.length })
        ctx.activity.log('system', `Updated routing policy (${body.policies.length} origins, ${body.tagOverrides.length} tag overrides)`, { category: 'models' })
        return Response.json({ ok: true })
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
        (ctx as unknown as PluginContext).updateSettings({ budget: body })
        ctx.activity.audit('budget.updated', 'system', { hasGlobal: !!body.global, perAgent: Object.keys(body.perAgent ?? {}).length })
        ctx.activity.log('system', 'Updated budget policy', { category: 'models' })
        return Response.json({ ok: true })
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
        const sinceMs = window === 'all' ? 0 : Date.now() - SPEND_WINDOW_MS[window]
        const byModel = spendByModel(sinceMs).map((r) => ({ ...r, model: r.model || 'unknown' }))
        return Response.json({
          window,
          estimated: true,
          totalUsdMicros: spendTotal({ sinceMs }),
          byAgent: spendByAgent(sinceMs),
          byModel,
        })
      } catch (err) {
        // A reporting read must not crash the page when the ledger is down.
        if (err instanceof LedgerUnavailableError) {
          return Response.json({ error: 'Spend ledger unavailable', totalUsdMicros: 0, byAgent: [], byModel: [] }, { status: 500 })
        }
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/runtime/status',
    method: 'GET',
    summary: 'Runtime config sync status',
    description: 'Reports whether the runtime config is out of sync with disk and needs a restart.',
    responses: { 200: passthrough },
    handler: async () => {
      const sync = getRuntimeSync()
      const restartNeeded = sync.lastConfigChangeAt !== null &&
        (sync.lastRestartAt === null || sync.lastConfigChangeAt > sync.lastRestartAt)
      return Response.json({ restartNeeded, ...sync })
    },
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
        markRuntimeRestarted()
        setModelsCache(null)
        clearPersistedCache()
        ctx.activity.audit('runtime.restarted', 'system')
        ctx.activity.log('system', 'Runtime restarted', { category: 'models' })
        return Response.json({ ok: true, message: 'Restart initiated' })
      } catch (err) {
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),
]
