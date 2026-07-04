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
  readConfig,
  updateConfig,
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
        const agents = await resolveAgents(ctx as unknown as PluginContext)
        const config = await readConfig(ctx as unknown as PluginContext)
        return Response.json({
          agents,
          defaultModel: normalizeModelId(config.agents.defaults.model.primary),
          defaultSubagentModel: config.agents.defaults.subagents?.model
            ? normalizeModelId(config.agents.defaults.subagents.model)
            : null,
          fallbackModels: (config.agents.defaults.model.fallbacks ?? []).map(normalizeModelId),
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
        const oldModel = before?.effectiveModel ?? null

        await updateConfig(ctx as unknown as PluginContext, 'models.update-agent-config', (config) => {
          const agent = config.agents.list.find((a) => a.id === agentId)
          if (!agent) throw new Error(`Agent "${agentId}" not found`)
          if (body.ownModel !== undefined) {
            if (body.ownModel) {
              agent.model = { primary: normalizeModelId(body.ownModel) }
            } else {
              delete agent.model
            }
          }
          if (body.subagentModel !== undefined) {
            if (body.subagentModel) {
              if (!agent.subagents) agent.subagents = {}
              agent.subagents.model = normalizeModelId(body.subagentModel)
            } else if (agent.subagents) {
              delete agent.subagents.model
            }
          }
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
        await updateConfig(ctx as unknown as PluginContext, 'models.update-defaults', (config) => {
          if (body.defaultModel) {
            config.agents.defaults.model.primary = normalizeModelId(body.defaultModel)
          }
          if (body.fallbackModels) {
            const fallbackSet = body.fallbackModels
              .map(normalizeModelId)
              .filter((id) => id !== normalizeModelId(config.agents.defaults.model.primary))
            config.agents.defaults.model.fallbacks = [...new Set(fallbackSet)]
          }
          if (body.defaultSubagentModel !== undefined) {
            if (!config.agents.defaults.subagents) {
              config.agents.defaults.subagents = {}
            }
            if (body.defaultSubagentModel) {
              config.agents.defaults.subagents.model = body.defaultSubagentModel
            } else {
              delete config.agents.defaults.subagents.model
            }
          }
        })

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
        const config = await readConfig(ctx as unknown as PluginContext)
        const aliases = readAliases(config)
        return Response.json({ aliases })
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
        await updateConfig(ctx as unknown as PluginContext, 'models.update-aliases', (config) => {
          if (!config.agents.defaults.models) {
            config.agents.defaults.models = {}
          }
          if ('aliases' in body) {
            const newModels: Record<string, unknown> = {}
            for (const [alias, target] of Object.entries(body.aliases)) {
              newModels[alias] = { alias: normalizeModelId(target) }
            }
            config.agents.defaults.models = newModels
          } else if ('action' in body) {
            if (body.action === 'add') {
              (config.agents.defaults.models as Record<string, unknown>)[body.name] = { alias: normalizeModelId(body.target) }
            } else if (body.action === 'delete') {
              delete (config.agents.defaults.models as Record<string, unknown>)[body.name]
            } else if (body.action === 'prepopulate') {
              const models = config.agents.defaults.models as Record<string, unknown>
              for (const [alias, target] of Object.entries(DEFAULT_ALIASES)) {
                if (!(alias in models)) {
                  models[alias] = { alias: target }
                }
              }
            }
          }
        })

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
