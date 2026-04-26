/**
 * Self-documenting API for Bakin.
 * Collects route registrations from plugins and core, generates docs.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { createLogger } from './logger'
import type { APIRoute } from '../../packages/core/src/plugin-types'
import type { ContractStability, ContractVisibility, DocsExample, SchemaLike, SourceLocation } from '../../packages/core/src/docs'

const log = createLogger('api-docs')

export interface RouteDoc {
  pluginId: string
  method: string
  path: string
  fullPath: string
  summary: string
  description?: string
  params?: string
  input?: SchemaLike
  output?: SchemaLike
  visibility: ContractVisibility
  stability: ContractStability
  examples?: DocsExample[]
  source?: SourceLocation
  permissions?: string[]
}

const routeDocs: RouteDoc[] = []

// Core routes (registered manually, not through plugin system)
const CORE_ROUTES: RouteDoc[] = [
  coreRoute('GET', '/api/events', 'SSE event stream', 'Real-time updates for file changes, task events, alerts.'),
  coreRoute('GET', '/api/dispatch', 'Get dispatch timer state', 'Returns interval, last run, next run, and dispatched count.'),
  coreRoute('POST', '/api/dispatch', 'Trigger dispatch', 'Triggers an immediate task dispatch cycle.'),
  coreRoute('GET', '/api/settings', 'Get settings', 'Returns current Bakin settings.'),
  coreRoute('POST', '/api/settings', 'Update settings', 'Updates Bakin settings with a partial merge.', 'JSON object with settings keys to update'),
  coreRoute('POST', '/api/internal/continuation', 'Trigger continuation check', 'Triggers dependency continuation checks.', '{"completedTaskId":"string","completedTitle":"string"}', 'internal'),
  coreRoute('POST', '/api/activity/emit', 'Emit activity event', 'Emits an activity event via SSE.', '{"agent":"string","message":"string","ts":"string"}'),
  coreRoute('GET', '/api/docs', 'Get API documentation', 'Returns API route documentation as JSON.'),
  coreRoute('GET', '/api/search', 'Search indexed content', 'Searches across indexed content. Requires Antfly.', '?q=<query>&table=<optional>&limit=<optional>'),
  coreRoute('GET', '/api/agents', 'List agents', 'Lists all agents with status and active tasks.'),
  coreRoute('GET', '/api/agents/:id', 'Get agent status', 'Returns agent status.'),
  coreRoute('GET', '/api/agents/:id/status', 'Get detailed agent status', 'Returns detailed status for one agent.'),
  coreRoute('POST', '/api/agents/:id/message', 'Send message to agent', 'Sends a message to an agent.', '{"message":"string"}'),
  coreRoute('GET', '/api/agents/:id/tasks', 'Get agent tasks', 'Returns tasks assigned to an agent.'),
  coreRoute('POST', '/api/plugins/install', 'Install plugin', 'Installs a plugin.', '{"source":"string","type":"local|github"}'),
  coreRoute('POST', '/api/plugins/remove', 'Remove plugin', 'Removes an installed plugin.', '{"pluginId":"string"}'),
  coreRoute('POST', '/api/reindex', 'Trigger reindex', 'Triggers a full content reindex to Antfly.'),
]

function coreRoute(
  method: RouteDoc['method'],
  path: string,
  summary: string,
  description: string,
  params?: string,
  visibility: ContractVisibility = 'public',
): RouteDoc {
  return {
    pluginId: 'core',
    method,
    path,
    fullPath: path,
    summary,
    description,
    params,
    visibility,
    stability: visibility === 'internal' ? 'experimental' : 'stable',
  }
}

/** Tests call this between cases — bun:test has no vi.resetModules equivalent. */
export function _resetRouteDocsForTests(): void {
  routeDocs.length = 0
}

/**
 * Register a plugin route for documentation.
 */
export function registerRouteDoc(pluginId: string, route: Pick<APIRoute, 'path' | 'method' | 'summary' | 'description' | 'params' | 'input' | 'output' | 'visibility' | 'stability' | 'examples' | 'source' | 'permissions'>): void {
  const summary = route.summary ?? route.description ?? `${route.method} ${route.path}`
  routeDocs.push({
    pluginId,
    method: route.method,
    path: route.path,
    fullPath: `/api/plugins/${pluginId}${route.path}`,
    summary,
    description: route.description,
    params: route.params,
    input: route.input,
    output: route.output,
    visibility: route.visibility ?? 'public',
    stability: route.stability ?? 'stable',
    examples: route.examples,
    source: route.source,
    permissions: route.permissions,
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
    '# Bakin API Documentation',
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
      lines.push(route.summary)
      if (route.description) lines.push(`${route.description}`)
      if (route.params) lines.push(`\n**Parameters:** \`${route.params}\``)
      lines.push(`\n**Visibility:** \`${route.visibility}\`  `)
      lines.push(`**Stability:** \`${route.stability}\``)
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
