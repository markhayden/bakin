/**
 * Health plugin — server entry point.
 * Aggregates MCP stats, doctor diagnostics, request logs, and system info.
 */
import { totalmem } from 'os'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { getLastResults, runDiagnostics } from '../../src/core/doctor'
import { createLogger } from '../../src/core/logger'
import { getAllAgentUsage } from '../../src/core/agent-usage'
import { getSettings } from '../../src/core/settings'
import { getContentDir } from '../../src/core/content-dir'
import { getUsageFeed, getErrorCount, getStatsByMs, WINDOW_MS, type UsageKind, type WindowKey } from '../../src/core/usage'
import {
  listHealthChecks,
  getHealthCheck,
  type HealthCheckDef,
} from './lib/health-check-registry'
import { checkContentDir } from './lib/system-checks/content-dir'
import { checkService } from './lib/system-checks/service'
import { checkMcporter } from './lib/system-checks/mcporter'
import { checkRuntime } from './lib/system-checks/runtime'
import { checkChannelApprovals } from './lib/system-checks/channel-approvals'
import { checkSearchAdapter } from './lib/system-checks/search'
import { checkOrchestratorRules } from './lib/system-checks/orchestrator-rules'
import { checkAndSyncSkill } from './lib/system-checks/sync-skill'
import { checkPluginAssets } from './lib/system-checks/plugin-assets'
import { applyAllManagedBlocksForRuntime } from './lib/managed-blocks'
// Registry accessors live on globalThis because Next.js API routes get
// separate webpack-compiled module instances with empty Maps. The custom
// server (server.ts) registers the real accessors after plugin init.
type RegistryAccessor = () => Array<Record<string, unknown>>
type McpSessionsAccessor = () => { activeSessions: Array<{ agent: string; sessions: number; connectedAt: string }>; upSince: string }

function getRegistrySnapshot() {
  const fn = (globalThis as unknown as { __bakinGetRegistrySnapshot?: RegistryAccessor }).__bakinGetRegistrySnapshot
  return fn ? fn() : []
}

function getMcpSessions(): { activeSessions: Array<{ agent: string; sessions: number; connectedAt: string }>; upSince: string } {
  const fn = (globalThis as unknown as { __bakinGetMcpSessions?: McpSessionsAccessor }).__bakinGetMcpSessions
  return fn ? fn() : { activeSessions: [], upSince: new Date().toISOString() }
}

const log = createLogger('health')

function buildDoctorResponse(results: Array<{ status: string }> & unknown[]) {
  const errors = results.filter(r => r.status === 'error').length
  const warnings = results.filter(r => r.status === 'warn').length
  return { results, summary: { total: results.length, errors, warnings } }
}

const healthPlugin: BakinPlugin = {
  id: 'health',
  name: 'Health',
  version: '1.0.0',

  settingsSchema: {
    fields: [
      { key: 'refreshInterval', type: 'number', label: 'Refresh interval (seconds)', description: 'How often to poll for updated metrics', default: 30 },
      { key: 'showDetailedMetrics', type: 'boolean', label: 'Detailed metrics', description: 'Show per-plugin and per-tool breakdowns', default: true },
    ],
  },

  navItems: [
    { id: 'health', label: 'Health', icon: 'Activity', href: '/health', order: 85 },
  ],

  contentFiles: [],

  activate(ctx: PluginContext) {
    // ─── Health-check registry hooks + route ─────────────────────────
    // `run` is not serializable and isn't useful to consumers that only
    // want registry metadata. Strip it at the boundary.
    const stripRun = (def: HealthCheckDef) => ({
      id: def.id,
      name: def.name,
      pluginId: def.pluginId,
      autoFix: !!def.autoFix,
    })

    ctx.hooks.register('health.list', () => listHealthChecks().map(stripRun), { label: 'List health checks.', summary: 'Returns the health checks registered by core and plugins without executing them. Use it when another surface needs to show the available diagnostics or autofix support.', hookKind: 'rpc' })
    ctx.hooks.register('health.getCheck', (d: Record<string, unknown>) => {
      const def = getHealthCheck(d.id as string)
      return def ? stripRun(def) : null
    }, { label: 'Get a health check.', summary: 'Returns metadata for one registered health check by id, without running the check. Use it when a plugin needs the check name, owner, and autofix capability before deciding what to show or run.', hookKind: 'rpc' })

    ctx.registerRoute({
      path: '/checks',
      method: 'GET',
      description: 'List registered plugin health checks (metadata only; does not execute them).',
      handler: async () => new Response(
        JSON.stringify({ checks: listHealthChecks().map(stripRun) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    })

    // Aggregated health summary
    ctx.registerRoute({
      path: '/summary',
      method: 'GET',
      handler: async () => {
        const port = process.env.PORT || 3737

        // Use cached doctor results instead of triggering a full re-run.
        // The doctor timer runs every 30 minutes; this avoids re-running
        // diagnostics on every dashboard poll (every 10s).
        const cached = getLastResults()
        const doctor = cached ? {
          results: cached.results,
          summary: {
            total: cached.results.length,
            errors: cached.results.filter(r => r.status === 'error').length,
            warnings: cached.results.filter(r => r.status === 'warn').length,
          },
          cachedAt: new Date(cached.timestamp).toISOString(),
        } : null

        const mcp = getMcpSessions()
        const errors1h = getErrorCount(WINDOW_MS['1h'])

        return Response.json({
          doctor,
          errors1h,
          activeSessions: mcp.activeSessions,
          upSince: mcp.upSince,
          server: {
            port: Number(port),
            pid: process.pid,
            nodeVersion: process.version,
            memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
            totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
          },
        })
      },
    })

    // Unified usage feed — backs the tabbed usage section on the health page.
    // Query params: kind (mcp|rest|agent, optional), window (5m|1h|24h), agent (optional).
    ctx.registerRoute({
      path: '/usage-feed',
      method: 'GET',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const schema = z.object({
          kind: z.enum(['mcp', 'rest', 'agent']).optional(),
          window: z.enum(['5m', '1h', '24h']).default('1h'),
          agent: z.string().min(1).optional(),
        })
        const parsed = schema.safeParse({
          kind: url.searchParams.get('kind') ?? undefined,
          window: url.searchParams.get('window') ?? undefined,
          agent: url.searchParams.get('agent') ?? undefined,
        })
        if (!parsed.success) {
          return Response.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
        }
        const { kind, window, agent } = parsed.data
        return Response.json(getUsageFeed({
          ...(kind ? { kind: kind as UsageKind } : {}),
          window: window as WindowKey,
          ...(agent ? { agent } : {}),
        }))
      },
    })

    // Search adapter health + index stats
    ctx.registerRoute({
      path: '/search-status',
      method: 'GET',
      handler: async () => {
        const health = ctx.search.health ? await ctx.search.health() : { enabled: false, tables: [] }
        return Response.json(health)
      },
    })

    // Agent context/token usage from runtime sessions
    ctx.registerRoute({
      path: '/usage',
      method: 'GET',
      handler: async () => {
        return Response.json(await getAllAgentUsage(ctx.runtime))
      },
    })

    // Registry: all registered plugins. Per-tool call counts are now
    // available via the unified usage recorder (`/usage-feed?kind=mcp`).
    ctx.registerRoute({
      path: '/registry',
      method: 'GET',
      handler: async () => {
        return Response.json({
          plugins: getRegistrySnapshot(),
        })
      },
    })

    // Doctor — on-demand diagnostics, ?fresh=true forces re-run
    ctx.registerRoute({
      path: '/doctor',
      method: 'GET',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const fresh = url.searchParams.get('fresh') === 'true'

        if (!fresh) {
          const cached = getLastResults()
          if (cached) {
            return Response.json({
              ...buildDoctorResponse(cached.results),
              cachedAt: new Date(cached.timestamp).toISOString(),
            })
          }
        }

        try {
          const results = await runDiagnostics(getContentDir(), process.cwd())
          return Response.json({
            ...buildDoctorResponse(results),
            cachedAt: new Date().toISOString(),
          })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // --- Exec tools (MCP) ---

    ctx.registerExecTool({
      name: 'bakin_exec_health_status',
      label: 'Checked system health',
      description: 'Get a quick system health summary — uptime, memory, active MCP sessions, and doctor error/warning counts. Useful for checking system state before starting work.',
      parameters: {},
      handler: async () => {
        const cached = getLastResults()
        const mcp = getMcpSessions()
        const stats1h = getStatsByMs({ windowMs: WINDOW_MS['1h'] })

        const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024)
        const totalMemoryMB = Math.round(totalmem() / 1024 / 1024)

        return {
          ok: true,
          uptime: mcp.upSince,
          memoryMB,
          totalMemoryMB,
          memoryPercent: Math.round((memoryMB / totalMemoryMB) * 100),
          activeSessions: mcp.activeSessions.length,
          calls1h: stats1h.total,
          errors1h: stats1h.errors,
          doctorErrors: cached ? cached.results.filter(r => r.status === 'error').length : null,
          doctorWarnings: cached ? cached.results.filter(r => r.status === 'warn').length : null,
          doctorLastRun: cached ? new Date(cached.timestamp).toISOString() : null,
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_health_doctor',
      label: 'Ran diagnostics',
      description: 'Run system diagnostics (agent roster, skill sync, runtime, taskboard, assets, etc.). Returns detailed check results. Use fresh=true to force a full re-check instead of returning cached results.',
      parameters: {
        fresh: z.boolean().optional().describe('Force fresh diagnostics instead of cached results'),
      },
      handler: async (params: Record<string, unknown>) => {
        const fresh = params.fresh === true

        if (!fresh) {
          const cached = getLastResults()
          if (cached) {
            return {
              ok: true,
              ...buildDoctorResponse(cached.results),
              cachedAt: new Date(cached.timestamp).toISOString(),
            }
          }
        }

        try {
          const results = await runDiagnostics(getContentDir(), process.cwd())
          return { ok: true, ...buildDoctorResponse(results), cachedAt: new Date().toISOString() }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    // ─── System health checks (migrated out of core/doctor.ts per #139 C6+) ──
    ctx.registerHealthCheck({
      id: 'content-dir',
      name: 'Content directory location',
      run: () => Promise.resolve(checkContentDir()),
    })
    ctx.registerHealthCheck({
      id: 'service',
      name: 'macOS LaunchAgent plist',
      run: () => Promise.resolve(checkService(process.cwd())),
    })
    ctx.registerHealthCheck({
      id: 'mcporter',
      name: 'mcporter install + per-agent config',
      autoFix: true,
      run: () => checkMcporter(),
    })
    ctx.registerHealthCheck({
      id: 'runtime',
      name: 'Runtime reachability',
      run: () => checkRuntime(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'channel-approvals',
      name: 'Runtime channel approval responses',
      run: () => checkChannelApprovals(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'search',
      name: 'Search adapter binary + daemon connection',
      run: () => checkSearchAdapter(),
    })
    ctx.registerHealthCheck({
      id: 'orchestrator-rules',
      name: 'Main agent AGENTS.md orchestrator-rules block',
      autoFix: true,
      run: () => checkOrchestratorRules(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'skill',
      name: 'Bakin SKILL.md sync to runtime',
      autoFix: true,
      run: () => checkAndSyncSkill(process.cwd(), ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'plugin-assets',
      name: 'Plugin-shipped runtime skills install state',
      run: () => checkPluginAssets(),
    })
    ctx.registerHealthCheck({
      id: 'managed-blocks',
      name: 'Per-agent managed blocks in AGENTS.md',
      autoFix: true,
      run: () => applyAllManagedBlocksForRuntime(ctx.runtime, getSettings().doctor.autoFixSkill),
    })
  },

  onReady() {
    const cached = getLastResults()
    if (cached) {
      const errors = cached.results.filter(r => r.status === 'error').length
      const warns = cached.results.filter(r => r.status === 'warn').length
      log.info(`Ready — baseline: ${errors} errors, ${warns} warnings from ${cached.results.length} checks`)
    } else {
      log.info('Ready — no cached doctor results yet')
    }
  },
}

export default healthPlugin
