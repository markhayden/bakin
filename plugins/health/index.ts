/**
 * Health plugin — server entry point.
 * Aggregates MCP stats, doctor diagnostics, request logs, and system info.
 */
import type { MCPlugin, PluginContext } from '../../src/lib/plugin-types'
import { getRequestStats } from '../../src/core/request-log'

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

        const [mcpRes, doctorRes] = await Promise.allSettled([
          fetch(`${base}/mcp/stats`).then(r => r.json()),
          fetch(`${base}/api/doctor`).then(r => r.json()),
        ])

        const mcp = mcpRes.status === 'fulfilled' ? mcpRes.value : null
        const doctor = doctorRes.status === 'fulfilled' ? doctorRes.value : null
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
