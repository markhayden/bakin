/**
 * Self-documenting API for Beacon.
 * Collects route registrations from plugins and core, generates docs.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { createLogger } from './logger'

const log = createLogger('api-docs')

export interface RouteDoc {
  pluginId: string
  method: string
  path: string
  fullPath: string
  description?: string
  params?: string
}

const routeDocs: RouteDoc[] = []

// Core routes (registered manually, not through plugin system)
const CORE_ROUTES: RouteDoc[] = [
  { pluginId: 'core', method: 'GET', path: '/api/events', fullPath: '/api/events', description: 'SSE event stream — real-time updates for file changes, task events, alerts' },
  { pluginId: 'core', method: 'GET', path: '/api/dispatch', fullPath: '/api/dispatch', description: 'Get dispatch timer state — interval, last run, next run, dispatched count' },
  { pluginId: 'core', method: 'POST', path: '/api/dispatch', fullPath: '/api/dispatch', description: 'Trigger immediate task dispatch cycle' },
  { pluginId: 'core', method: 'GET', path: '/api/settings', fullPath: '/api/settings', description: 'Get current Beacon settings' },
  { pluginId: 'core', method: 'POST', path: '/api/settings', fullPath: '/api/settings', description: 'Update Beacon settings (partial merge)', params: 'JSON object with settings keys to update' },
  { pluginId: 'core', method: 'POST', path: '/api/internal/continuation', fullPath: '/api/internal/continuation', description: 'Trigger dependency continuation check', params: '{"completedTaskId":"string","completedTitle":"string"}' },
  { pluginId: 'core', method: 'POST', path: '/api/activity/emit', fullPath: '/api/activity/emit', description: 'Emit activity event via SSE', params: '{"agent":"string","message":"string","ts":"string"}' },
  { pluginId: 'core', method: 'GET', path: '/api/docs', fullPath: '/api/docs', description: 'Get API documentation as JSON' },
  { pluginId: 'core', method: 'GET', path: '/api/search', fullPath: '/api/search', description: 'Search across all indexed content (requires Antfly)', params: '?q=<query>&table=<optional>&limit=<optional>' },
  { pluginId: 'core', method: 'GET', path: '/api/agents', fullPath: '/api/agents', description: 'List all agents with status and active tasks' },
  { pluginId: 'core', method: 'GET', path: '/api/agents/:id', fullPath: '/api/agents/:id', description: 'Get agent status' },
  { pluginId: 'core', method: 'GET', path: '/api/agents/:id/status', fullPath: '/api/agents/:id/status', description: 'Get detailed agent status' },
  { pluginId: 'core', method: 'POST', path: '/api/agents/:id/message', fullPath: '/api/agents/:id/message', description: 'Send a message to an agent', params: '{"message":"string"}' },
  { pluginId: 'core', method: 'GET', path: '/api/agents/:id/tasks', fullPath: '/api/agents/:id/tasks', description: 'Get tasks assigned to an agent' },
  { pluginId: 'core', method: 'POST', path: '/api/plugins/install', fullPath: '/api/plugins/install', description: 'Install a plugin', params: '{"source":"string","type":"local|github"}' },
  { pluginId: 'core', method: 'POST', path: '/api/plugins/remove', fullPath: '/api/plugins/remove', description: 'Remove an installed plugin', params: '{"pluginId":"string"}' },
  { pluginId: 'core', method: 'GET', path: '/api/doctor', fullPath: '/api/doctor', description: 'Run health checks (agent roster, skill sync, gateway, Antfly, taskboard)' },
  { pluginId: 'core', method: 'POST', path: '/api/reindex', fullPath: '/api/reindex', description: 'Trigger full content reindex to Antfly' },
]

/**
 * Register a plugin route for documentation.
 */
export function registerRouteDoc(pluginId: string, route: { path: string; method: string; description?: string; params?: string }): void {
  routeDocs.push({
    pluginId,
    method: route.method,
    path: route.path,
    fullPath: `/api/plugins/${pluginId}${route.path}`,
    description: route.description,
    params: route.params,
  })
}

/**
 * Get all documented routes (core + plugin).
 */
export function getAllRoutes(): RouteDoc[] {
  return [...CORE_ROUTES, ...routeDocs]
}

/**
 * Generate API documentation as markdown and write to content/docs/API.md
 */
export function generateDocs(contentDir: string): void {
  const allRoutes = getAllRoutes()
  const grouped = new Map<string, RouteDoc[]>()

  for (const route of allRoutes) {
    if (!grouped.has(route.pluginId)) grouped.set(route.pluginId, [])
    grouped.get(route.pluginId)!.push(route)
  }

  const lines: string[] = [
    '# Beacon API Documentation',
    '',
    `_Auto-generated at ${new Date().toISOString()}_`,
    '',
    `**Base URL:** \`http://localhost:${process.env.PORT || 3737}\``,
    '',
    '---',
    '',
  ]

  for (const [pluginId, routes] of grouped) {
    lines.push(`## ${pluginId === 'core' ? 'Core Routes' : `Plugin: ${pluginId}`}`)
    lines.push('')

    for (const route of routes) {
      lines.push(`### \`${route.method} ${route.fullPath}\``)
      if (route.description) lines.push(`${route.description}`)
      if (route.params) lines.push(`\n**Parameters:** \`${route.params}\``)
      lines.push('')
    }

    lines.push('---')
    lines.push('')
  }

  const docsDir = join(contentDir, 'docs')
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true })

  const docsPath = join(docsDir, 'API.md')
  writeFileSync(docsPath, lines.join('\n'), 'utf-8')
  log.info('API docs generated', { routes: allRoutes.length, path: docsPath })
}
