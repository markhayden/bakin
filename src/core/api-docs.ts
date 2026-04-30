/**
 * Self-documenting API for Bakin.
 * Collects route registrations from plugins and core, generates docs.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
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
  coreRoute('GET', '/api/dev/events', 'Dev SSE event stream', 'Development-only browser reload and notification event stream.', undefined, 'internal'),
  coreRoute('POST', '/api/dev/notify', 'Emit development notification', 'Development-only watcher bridge for browser rebuild notifications.', '{"type":"string","payload":"object"}', 'internal'),
  coreRoute('GET', '/api/version', 'Get runtime version', 'Returns the running Bakin version.'),
  coreRoute('GET', '/api/dispatch', 'Get dispatch timer state', 'Returns interval, last run, next run, and dispatched count.'),
  coreRoute('POST', '/api/dispatch', 'Trigger dispatch', 'Triggers an immediate task dispatch cycle.'),
  coreRoute('GET', '/api/settings', 'Get settings', 'Returns current Bakin settings.'),
  coreRoute('POST', '/api/settings', 'Update settings', 'Updates Bakin settings with a partial merge.', 'JSON object with settings keys to update'),
  coreRoute('POST', '/api/internal/continuation', 'Trigger continuation check', 'Triggers dependency continuation checks.', '{"completedTaskId":"string","completedTitle":"string"}', 'internal'),
  coreRoute('POST', '/api/activity/emit', 'Emit activity event', 'Emits an activity event via SSE.', '{"agent":"string","message":"string","ts":"string"}'),
  coreRoute('GET', '/api/activity', 'List activity feed events', 'Returns unified activity data from audit events and task logs.'),
  coreRoute('GET', '/api/docs', 'Get API documentation', 'Returns API route documentation as JSON.'),
  coreRoute('GET', '/api/paths', 'Get resolved runtime paths', 'Returns important local filesystem paths used by the runtime.'),
  coreRoute('GET', '/api/search', 'Search indexed content', 'Searches across indexed content through the search adapter.', '?q=<query>&table=<optional>&limit=<optional>'),
  coreRoute('GET', '/api/state', 'Get dashboard state snapshot', 'Returns the current host dashboard state.'),
  coreRoute('GET', '/api/agents', 'List agents', 'Lists all agents with status and active tasks.'),
  coreRoute('GET', '/api/agents/avatar', 'Get agent avatar', 'Serves an agent avatar image.', '?id=<agentId>'),
  coreRoute('GET', '/api/agents/health', 'List agent health status', 'Returns enriched heartbeat and staleness data for agents.'),
  coreRoute('GET', '/api/agents/settings', 'Get agent settings', 'Returns host display and behavior settings for agents.'),
  coreRoute('PUT', '/api/agents/settings', 'Update agent settings', 'Updates host display and behavior settings for agents.', 'JSON object with agent settings keys to update'),
  coreRoute('POST', '/api/agents/start', 'Start an agent', 'Starts an agent through the active runtime.', '{"agentId":"string"}'),
  coreRoute('POST', '/api/agents/stop', 'Stop an agent', 'Stops an agent through the active runtime.', '{"agentId":"string"}'),
  coreRoute('POST', '/api/agents/restart', 'Restart an agent', 'Restarts an agent through the active runtime.', '{"agentId":"string"}'),
  coreRoute('GET', '/api/agents/:id', 'Get agent status', 'Returns agent status.'),
  coreRoute('GET', '/api/agents/:id/status', 'Get detailed agent status', 'Returns detailed status for one agent.'),
  coreRoute('POST', '/api/agents/:id/message', 'Send message to agent', 'Sends a message to an agent.', '{"message":"string"}'),
  coreRoute('GET', '/api/agents/:id/tasks', 'Get agent tasks', 'Returns tasks assigned to an agent.'),
  coreRoute('GET', '/api/agent-packages', 'List agent packages', 'Lists installed agent packages.'),
  coreRoute('POST', '/api/agent-packages/install', 'Install agent package', 'Installs an agent package from a local path or GitHub source.', '{"source":"string","adopt":"boolean?","installAs":"string?"}'),
  coreRoute('DELETE', '/api/agent-packages/:agentId', 'Remove agent package', 'Removes an installed agent package.', '{"keepBlocks":"boolean?","deleteAgent":"boolean?","force":"boolean?"}'),
  coreRoute('POST', '/api/agent-packages/:agentId/update', 'Update agent package', 'Updates an installed agent package from its recorded source.', '{"refreshTemplate":"boolean?"}'),
  coreRoute('GET', '/api/agent-packages/:agentId/knowledge', 'List agent package knowledge', 'Lists knowledge lessons and enablement state for an installed agent package.'),
  coreRoute('POST', '/api/agent-packages/:agentId/knowledge/:lessonId', 'Toggle agent package knowledge', 'Enables or disables one knowledge lesson for an installed agent package.', '{"enabled":"boolean"}'),
  coreRoute('POST', '/api/exec-tools/:toolName', 'Run an exec tool', 'Invokes a registered Bakin execution tool.', 'Tool-specific JSON object.'),
  coreRoute('POST', '/api/memory/log', 'Append memory log entry', 'Appends a decision, learned item, or note to the shared memory log.', '{"type":"decision|learned|note","message":"string"}'),
  coreRoute('GET', '/api/packages', 'List reusable packages', 'Lists installed reusable agent packages.'),
  coreRoute('POST', '/api/packages/install', 'Install reusable package', 'Installs a reusable agent package from a local path or GitHub source.', '{"source":"string"}'),
  coreRoute('DELETE', '/api/packages/:packageId', 'Remove reusable package', 'Removes an installed reusable package when it is not referenced by agents.'),
  coreRoute('POST', '/api/packages/:packageId/update', 'Update reusable package', 'Updates a reusable package from its recorded source.'),
  coreRoute('GET', '/api/curated', 'List curated installable packages', 'Lists curated packages available for installation.'),
  coreRoute('GET', '/api/assets/:path', 'Serve asset file', 'Serves a runtime asset file by canonical path.'),
  coreRoute('GET', '/api/plugin-settings/schemas', 'List plugin settings schemas', 'Returns settings schemas registered by plugins.'),
  coreRoute('GET', '/api/plugin-settings/:pluginId', 'Get plugin settings', 'Returns persisted settings for one plugin.'),
  coreRoute('PUT', '/api/plugin-settings/:pluginId', 'Update plugin settings', 'Updates persisted settings for one plugin.', 'Plugin settings JSON object.'),
  coreRoute('POST', '/api/plugins/install', 'Install plugin', 'Installs a plugin.', '{"source":"string","type":"local|github"}'),
  coreRoute('POST', '/api/plugins/link', 'Link local plugin', 'Registers a developer-owned plugin source tree as a live linked plugin.', '{"path":"string"}'),
  coreRoute('GET', '/api/plugins/manifest', 'Get plugin manifest bundle', 'Returns the aggregated plugin manifest used by the host UI.'),
  coreRoute('GET', '/api/plugins/:pluginId/assets/:path', 'Serve plugin client asset', 'Serves a plugin client JavaScript, CSS, or static asset file.'),
  coreRoute('GET', '/api/plugins/memory/audit', 'List memory audit entries', 'Returns recent entries from the memory plugin audit log.'),
  coreRoute('GET', '/api/plugins/memory/workspace', 'Get memory workspace bundle', 'Returns workspace memory files for one agent.', '?agentId=<agentId>'),
  coreRoute('POST', '/api/plugins/remove', 'Remove plugin', 'Removes an installed plugin.', '{"pluginId":"string"}'),
  coreRoute('POST', '/api/plugins/unlink', 'Unlink local plugin', 'Removes a linked plugin symlink and lockfile entry.', '{"pluginId":"string"}'),
  coreRoute('POST', '/api/plugins/upgrade', 'Upgrade plugin', 'Updates a user plugin from its recorded source.', '{"pluginId":"string"}'),
  coreRoute('POST', '/api/reindex', 'Trigger reindex', 'Triggers a full content reindex through the search adapter.'),
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
