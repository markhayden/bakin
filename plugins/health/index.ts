/**
 * Health plugin — server entry point.
 * Aggregates MCP stats, doctor diagnostics, request logs, and system info.
 */
import { totalmem } from 'os'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { getRequestStats, getRecentStatsForPathPrefix, getRestStatsByPlugin } from '../../src/core/request-log'
import { getLastResults, runDiagnostics } from '../../src/core/doctor'
import { createLogger } from '../../src/core/logger'
import { getAllAgentUsage } from '../../src/core/agent-usage'
import { getSettings } from '../../src/core/settings'
import { getContentDir } from '../../src/core/content-dir'
import { getSearchHealth } from '../../src/core/search-registry'
import { getUsageFeed, getErrorCount, WINDOW_MS, type UsageKind, type WindowKey } from '../../src/core/usage'
// Registry accessors live on globalThis because Next.js API routes get
// separate webpack-compiled module instances with empty Maps. The custom
// server (server.ts) registers the real accessors after plugin init.
function getRegistrySnapshot() {
  const fn = (globalThis as any).__bakinGetRegistrySnapshot
  return fn ? fn() : []
}

const log = createLogger('health')

function getExecToolStats() {
  const fn = (globalThis as any).__bakinGetExecToolStats
  return fn ? fn() : []
}

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
    // Aggregated health summary
    ctx.registerRoute({
      path: '/summary',
      method: 'GET',
      handler: async () => {
        const port = process.env.PORT || 3737
        const base = `http://localhost:${port}`

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

        let mcp = null
        try {
          const mcpRes = await fetch(`${base}/mcp/stats`)
          mcp = await mcpRes.json()
        } catch { /* MCP stats are optional */ }

        const requests = getRequestStats()

        const settings = getSettings()

        // Two windows: a tight one (60s) for "is it on fire right now?"
        // and a wider one (1h) for the rolling success-rate tile.
        const mcpHot = getRecentStatsForPathPrefix('/mcp', 60 * 1000)
        const mcpHour = getRecentStatsForPathPrefix('/mcp', 60 * 60 * 1000)
        const successRate = mcpHour.total > 0
          ? (mcpHour.total - mcpHour.errors) / mcpHour.total
          : 1
        const mcpHealth = {
          windowSec: 3600,
          total: mcpHour.total,
          errors: mcpHour.errors,
          successRate,
          recent: { windowSec: 60, total: mcpHot.total, errors: mcpHot.errors },
        }

        // REST traffic bucketed by plugin id — surfaces which plugins
        // agents are hitting via REST instead of MCP exec tools. Agents
        // SHOULD be using MCP exclusively; any non-trivial REST traffic
        // from an agent channel is a signal of a bad habit.
        const restHour = getRestStatsByPlugin(60 * 60 * 1000)
        const restHot = getRestStatsByPlugin(60 * 1000)
        const restHealth = {
          windowSec: 3600,
          total: restHour.total,
          errors: restHour.errors,
          successRate: restHour.successRate,
          byPlugin: restHour.byPlugin,
          recent: { windowSec: 60, total: restHot.total, errors: restHot.errors, byPlugin: restHot.byPlugin },
        }

        const errors1h = getErrorCount(WINDOW_MS['1h'])

        return Response.json({
          mcp,
          mcpHealth,
          restHealth,
          doctor,
          requests,
          errors1h,
          openclawPort: settings.openclaw.gatewayPort,
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

    // Antfly search engine health + index stats
    ctx.registerRoute({
      path: '/antfly-status',
      method: 'GET',
      handler: async () => {
        return Response.json(await getSearchHealth())
      },
    })

    // Recent request log (standalone, lightweight)
    ctx.registerRoute({
      path: '/requests',
      method: 'GET',
      handler: async () => {
        return Response.json(getRequestStats())
      },
    })

    // Agent context/token usage from OpenClaw sessions
    ctx.registerRoute({
      path: '/usage',
      method: 'GET',
      handler: async () => {
        return Response.json(getAllAgentUsage())
      },
    })

    // Registry: all registered plugins, exec tools, and skills
    ctx.registerRoute({
      path: '/registry',
      method: 'GET',
      handler: async () => {
        return Response.json({
          plugins: getRegistrySnapshot(),
          execTools: getExecToolStats(),
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
        const port = process.env.PORT || 3737
        const base = `http://localhost:${port}`
        const requests = getRequestStats()
        const cached = getLastResults()

        let activeSessions = 0
        try {
          const mcpRes = await fetch(`${base}/mcp/stats`)
          const mcp = await mcpRes.json()
          activeSessions = mcp.activeSessions?.length ?? 0
        } catch { /* optional */ }

        const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024)
        const totalMemoryMB = Math.round(totalmem() / 1024 / 1024)

        return {
          ok: true,
          uptime: requests.upSince || null,
          memoryMB,
          totalMemoryMB,
          memoryPercent: Math.round((memoryMB / totalMemoryMB) * 100),
          activeSessions,
          apiRequests: requests.totalRequests,
          apiErrors: requests.totalErrors,
          doctorErrors: cached ? cached.results.filter(r => r.status === 'error').length : null,
          doctorWarnings: cached ? cached.results.filter(r => r.status === 'warn').length : null,
          doctorLastRun: cached ? new Date(cached.timestamp).toISOString() : null,
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_health_doctor',
      label: 'Ran diagnostics',
      description: 'Run system diagnostics (agent roster, skill sync, gateway, taskboard, assets, etc.). Returns detailed check results. Use fresh=true to force a full re-check instead of returning cached results.',
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
