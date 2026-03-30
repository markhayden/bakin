/**
 * Health plugin — server entry point.
 * Aggregates MCP stats, doctor diagnostics, request logs, and system info.
 */
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { getRequestStats } from '../../src/core/request-log'
import { getLastResults } from '../../src/core/doctor'
import { createLogger } from '../../src/core/logger'
import { getAllAgentUsage } from '../../src/core/agent-usage'
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

        return Response.json({
          mcp,
          doctor,
          requests,
          server: {
            port: Number(port),
            pid: process.pid,
            nodeVersion: process.version,
            memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
          },
        })
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
