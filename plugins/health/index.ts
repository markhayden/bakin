/**
 * Health plugin — server entry point.
 * Aggregates MCP stats, doctor diagnostics, request logs, and system info.
 */
import type { MCPlugin, PluginContext } from '../../src/lib/plugin-types'
import { getRequestStats } from '../../src/core/request-log'
import { getLastResults } from '../../src/core/doctor'

const healthPlugin: MCPlugin = {
  id: 'health',
  name: 'Health',
  version: '1.0.0',

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
  },
}

export default healthPlugin
