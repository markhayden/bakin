/**
 * Core route declarations.
 *
 * Each entry mirrors a route currently dispatched by `server.ts`'s inline
 * routing logic. The handlers here are documentation stubs — server.ts
 * owns the real dispatch. Wiring the dispatcher to invoke these handlers
 * (replacing the inline if/else in server.ts) is the next step beyond
 * the route-contracts work; for now this gives the validator and
 * OpenAPI generator typed contracts for the host's HTTP surface.
 *
 * Subject-grouped via comment markers below. After T18, this file is the
 * source of truth for core route metadata — `src/core/api-docs.ts`
 * `CORE_ROUTES` is removed.
 */

import { z } from 'zod'
import { operationStartResponseSchema } from '@bakin/core/operations'
import { defineCoreRoute } from '@bakin/core/routing'
import type { APIRoute } from '@bakin/core/routing'

// ─── Shared response shapes ──────────────────────────────────────────────
const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()
const okResponse = z.object({ ok: z.literal(true) }).passthrough()

// Stub handler — server.ts owns the real dispatch.
const stub = async () => Response.json({ error: 'core route not handled by core-routes layer' }, { status: 501 })

// ─── /api/agents (T14) ───────────────────────────────────────────────────
const agentsRoutes = [
  defineCoreRoute({ path: '/api/agents', method: 'GET', summary: 'List agents', description: 'Lists all agents with status and active tasks.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/avatar', method: 'GET', summary: 'Get agent avatar', description: 'Serves an agent avatar image.', query: z.object({ id: z.string() }), responses: { 200: { contentType: 'application/octet-stream' }, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/health', method: 'GET', activityClass: 'routine', summary: 'List agent health status', description: 'Returns enriched heartbeat and staleness data for agents.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/settings', method: 'GET', summary: 'Get agent settings', description: 'Returns host display and behavior settings for agents.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/settings', method: 'PUT', summary: 'Update agent settings', description: 'Updates host display and behavior settings for agents.', body: passthrough, responses: { 200: okResponse, 400: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/start', method: 'POST', summary: 'Start an agent', body: z.object({ agentId: z.string() }), responses: { 200: okResponse, 400: errorResponse, 500: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/stop', method: 'POST', summary: 'Stop an agent', body: z.object({ agentId: z.string() }), responses: { 200: okResponse, 400: errorResponse, 500: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/restart', method: 'POST', summary: 'Restart an agent', body: z.object({ agentId: z.string() }), responses: { 200: okResponse, 400: errorResponse, 500: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/:id', method: 'GET', activityClass: 'routine', summary: 'Get agent status', params: z.object({ id: z.string() }), responses: { 200: passthrough, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/:id/status', method: 'GET', activityClass: 'routine', summary: 'Get detailed agent status', params: z.object({ id: z.string() }), responses: { 200: passthrough, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/:id/message', method: 'POST', summary: 'Send message to agent', params: z.object({ id: z.string() }), body: z.object({ message: z.string() }), responses: { 200: okResponse, 400: errorResponse, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agents/:id/tasks', method: 'GET', summary: 'Get agent tasks', params: z.object({ id: z.string() }), responses: { 200: passthrough, 404: errorResponse }, handler: stub }),
]

// ─── /api/agent-packages, /api/packages, /api/dispatch, /api/settings (T15) ─
const dispatchAndPackagesRoutes = [
  defineCoreRoute({ path: '/api/dispatch', method: 'GET', activityClass: 'routine', summary: 'Get dispatch timer state', description: 'Returns interval, last run, next run, and dispatched count.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/dispatch', method: 'POST', summary: 'Trigger dispatch', description: 'Triggers an immediate task dispatch cycle.', body: { contentType: 'none' }, responses: { 200: passthrough, 500: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/settings', method: 'GET', activityClass: 'routine', summary: 'Get settings', description: 'Returns current Bakin settings.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/settings', method: 'POST', summary: 'Update settings', description: 'Updates Bakin settings with a partial merge.', body: passthrough, responses: { 200: okResponse, 400: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agent-packages', method: 'GET', activityClass: 'routine', summary: 'List agent packages', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/agent-packages/install', method: 'POST', summary: 'Install agent package (operation)', description: 'Starts an install operation (#895): 202 { operationId, bootId }; the install result is the operation result.', body: z.object({ source: z.string(), adopt: z.string().optional(), replace: z.boolean().optional(), installAs: z.string().optional() }), responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 400: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agent-packages/:agentId', method: 'DELETE', summary: 'Remove agent package (operation)', description: 'Starts a remove operation (#895): 202 { operationId, bootId }; 404 when the agent has no package.', params: z.object({ agentId: z.string() }), body: z.object({ keepBlocks: z.boolean().optional(), deleteAgent: z.boolean().optional(), force: z.boolean().optional() }).passthrough(), responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 400: errorResponse, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agent-packages/:agentId/sync', method: 'POST', summary: 'Sync agent (operation: fetch, recompose blocks, verify, receipt)', description: 'Starts a sync operation (#895): 202 { operationId, bootId }; the receipt is the operation result. check: true holds nothing and writes nothing.', params: z.object({ agentId: z.string() }), body: z.object({ check: z.boolean().optional(), reclaim: z.union([z.literal('all'), z.array(z.string())]).optional() }).passthrough(), responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 400: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agent-packages/:agentId/receipt', method: 'GET', summary: 'Latest sync receipt for an agent', params: z.object({ agentId: z.string() }), responses: { 200: passthrough, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agent-packages/migrate', method: 'POST', summary: 'One-time block migration (operation; caller owns consent)', description: 'Starts the migration operation (#895): 202 { operationId, bootId }; install-state is held from before the first read.', body: { contentType: 'none' }, responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema }, handler: stub }),
  defineCoreRoute({ path: '/api/agent-packages/:agentId/lessons', method: 'GET', summary: 'List agent package lessons', params: z.object({ agentId: z.string() }), responses: { 200: passthrough, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/agent-packages/:agentId/lessons/:lessonId', method: 'POST', summary: 'Toggle agent package lessons', description: 'Synchronous and bounded; takes install-state without waiting — 409 install_busy names the holder.', params: z.object({ agentId: z.string(), lessonId: z.string() }), body: z.object({ enabled: z.boolean() }), responses: { 200: okResponse, 404: errorResponse, 409: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/packages', method: 'GET', summary: 'List reusable packages', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/packages/install', method: 'POST', summary: 'Install reusable package (operation)', description: 'Starts an install operation (#895): 202 { operationId, bootId }; the install result is the operation result.', body: z.object({ source: z.string(), replace: z.boolean().optional(), installAs: z.string().optional() }), responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 400: errorResponse, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/packages/:packageId', method: 'DELETE', summary: 'Remove reusable package (operation)', description: 'Starts a remove operation (#895): 202 { operationId, bootId }; 404 when not installed.', params: z.object({ packageId: z.string() }), body: z.object({ keepBlocks: z.boolean().optional(), force: z.boolean().optional() }).passthrough(), responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 400: errorResponse, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/packages/:packageId/sync', method: 'POST', summary: 'Sync reusable package (operation)', description: 'Starts a sync operation (#895): 202 { operationId, bootId }; 404 when not installed. check: true holds nothing and writes nothing.', params: z.object({ packageId: z.string() }), body: z.object({ check: z.boolean().optional() }).passthrough(), responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 400: errorResponse, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/plugin-settings/schemas', method: 'GET', activityClass: 'routine', summary: 'List plugin settings schemas', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/plugin-settings/:pluginId', method: 'GET', activityClass: 'routine', summary: 'Get plugin settings', params: z.object({ pluginId: z.string() }), responses: { 200: passthrough, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/plugin-settings/:pluginId', method: 'PUT', summary: 'Update plugin settings', params: z.object({ pluginId: z.string() }), body: passthrough, responses: { 200: okResponse, 400: errorResponse }, handler: stub }),
]

// ─── /api/plugins/* + misc (T16) ─────────────────────────────────────────
const pluginsAndMiscRoutes = [
  defineCoreRoute({ path: '/api/plugins/install', method: 'POST', summary: 'Install plugin (preview → commit operations)', description: 'Every install is preview → commit (#895). Without accepted: a preview operation (fetch + check, holds nothing) whose result is awaitingConsent + consentToken or ready. With accepted: true (+ the consentToken when one was issued): the commit operation under install-state. Both answer 202 { operationId, bootId }. dev: true links synchronously.', body: z.object({ source: z.string(), type: z.enum(['local', 'github']), ref: z.string().optional(), accepted: z.boolean().optional(), consentToken: z.string().optional(), dev: z.boolean().optional(), force: z.boolean().optional() }), responses: { 200: passthrough, 202: operationStartResponseSchema, 400: errorResponse, 500: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/plugins/link', method: 'POST', summary: 'Link local plugin (operation)', description: 'Starts a link operation (#895) owning install-state: 202 { operationId, bootId }. Only validation is cancellable — the point of no return precedes --force\'s unlink, else the initial build.', body: z.object({ localPath: z.string(), force: z.boolean().optional() }), responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 400: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/plugins/manifest', method: 'GET', activityClass: 'routine', summary: 'Get plugin manifest bundle', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/plugins/:pluginId/assets/:path', method: 'GET', activityClass: 'routine', summary: 'Serve plugin client asset', params: z.object({ pluginId: z.string(), path: z.string() }), responses: { 200: { contentType: 'application/octet-stream' }, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/plugins/memory/audit', method: 'GET', summary: 'List memory audit entries', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/plugins/memory/workspace', method: 'GET', summary: 'Get memory workspace bundle', query: z.object({ agentId: z.string() }), responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/plugins/remove', method: 'POST', summary: 'Remove plugin (operation)', description: 'Starts a remove operation (#895) owning install-state — not cancellable (the plugin\'s uninstall hook runs first): 202 { operationId, bootId }. Invalid/core ids (400), not installed (404) and the removal-policy preflight (409) answer synchronously.', body: z.object({ pluginId: z.string() }), responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 400: errorResponse, 404: errorResponse, 409: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/plugins/restore', method: 'POST', summary: 'Restore plugin (operation)', description: 'listOnly answers synchronously. A restore is an operation (#895) owning install-state: 202 { operationId, bootId }; unpack and conflict checks are cancellable, the first delete (--force) or copy is the point of no return.', body: z.object({ pluginId: z.string(), snapshot: z.string().optional(), force: z.boolean().optional(), listOnly: z.boolean().optional() }), responses: { 200: passthrough, 202: operationStartResponseSchema, 400: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/plugins/unlink', method: 'POST', summary: 'Unlink local plugin', description: 'Synchronous and bounded; takes install-state without waiting — 409 install_busy names the holder.', body: z.object({ pluginId: z.string() }), responses: { 200: okResponse, 400: errorResponse, 409: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/plugins/upgrade', method: 'POST', summary: 'Upgrade plugin (preview → commit operations)', description: 'Two-phase, both operations (#895): the preview (holds nothing) ends awaitingConsent + consentToken when permissions or binaries widen, or ready + consentToken when nothing new needs consent; the commit (accepted + consentToken, under install-state) lands only while the target still matches. Both answer 202 { operationId, bootId }; a core plugin is refused synchronously.', body: z.object({ pluginId: z.string(), accepted: z.boolean().optional(), consentToken: z.string().optional() }), responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 400: errorResponse }, handler: stub }),

  defineCoreRoute({ path: '/api/version', method: 'GET', activityClass: 'routine', summary: 'Get runtime version', description: 'Returns the running Bakin version.', responses: { 200: z.object({ version: z.string() }) }, handler: stub }),
  defineCoreRoute({ path: '/api/update/status', method: 'GET', activityClass: 'routine', summary: 'Get Bakin update status', description: 'Returns whether a newer Bakin binary release is available and whether this runtime can self-update.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/update/apply', method: 'POST', summary: 'Apply Bakin update', description: 'Runs the guarded Bakin binary self-update flow.', body: { contentType: 'none' }, responses: { 200: okResponse, 400: errorResponse, 500: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/paths', method: 'GET', summary: 'Get resolved runtime paths', description: 'Returns important local filesystem paths used by the runtime.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/state', method: 'GET', activityClass: 'routine', summary: 'Get dashboard state snapshot', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/search', method: 'GET', summary: 'Search indexed content', description: 'Searches across indexed content through the search adapter.', query: z.object({ q: z.string(), table: z.string().optional(), limit: z.coerce.number().optional() }), responses: { 200: passthrough, 400: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/reindex', method: 'POST', summary: 'Reindex search (operation)', description: 'Starts a reindex operation (#895) owning search-engine — not cancellable: 202 { operationId, bootId }, 200 attached for an identical live request. Repair by default (?force=1 mints fresh generations, ?table= narrows to one table). The result is { ok, errors, parked, total, tables }; any failed or parked table ends the operation tables_parked.', query: z.object({ table: z.string().optional(), force: z.literal('1').optional() }), body: { contentType: 'none' }, responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema }, handler: stub }),
  defineCoreRoute({ path: '/api/search/reset', method: 'POST', summary: 'Reset the search engine (operation)', description: 'Starts a reset operation (#895) owning search-engine — not cancellable: stop → wipe derived engine data → clean start → repair reindex, as stages. 202 { operationId, bootId }; the result is { ok, message, reindex }. Disabled search or an adapter without reset answers 409 { ok: false, message }.', body: { contentType: 'none' }, responses: { 200: operationStartResponseSchema, 202: operationStartResponseSchema, 409: z.object({ ok: z.literal(false), message: z.string(), reindex: z.null() }) }, handler: stub }),
  defineCoreRoute({ path: '/api/activity', method: 'GET', activityClass: 'routine', summary: 'List activity feed events', description: 'Returns unified activity data from audit events and task logs.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/activity/emit', method: 'POST', summary: 'Emit activity event', body: z.object({ agent: z.string(), message: z.string(), ts: z.string() }), responses: { 200: okResponse, 400: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/internal/continuation', method: 'POST', summary: 'Trigger continuation check', visibility: 'internal', body: z.object({ completedTaskId: z.string(), completedTitle: z.string() }), responses: { 200: okResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/exec-tools/:toolName', method: 'POST', summary: 'Run an exec tool', params: z.object({ toolName: z.string() }), body: passthrough, responses: { 200: passthrough, 400: errorResponse, 500: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/memory/log', method: 'POST', summary: 'Append memory log entry', body: z.object({ type: z.enum(['decision', 'learned', 'note']), message: z.string() }), responses: { 200: okResponse, 400: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/assets/:path', method: 'GET', summary: 'Serve asset file', params: z.object({ path: z.string() }), responses: { 200: { contentType: 'application/octet-stream' }, 404: errorResponse }, handler: stub }),
  defineCoreRoute({ path: '/api/docs', method: 'GET', summary: 'Get API documentation', description: 'Legacy endpoint — returns route metadata in the {routes} shape for CLI consumers.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/openapi', method: 'GET', summary: 'Get live OpenAPI document', description: 'Returns the OpenAPI 3.1 document built from the runtime route registry.', responses: { 200: passthrough }, handler: stub }),
  defineCoreRoute({ path: '/api/events', method: 'GET', summary: 'SSE event stream', description: 'Real-time updates for file changes, task events, alerts.', responses: { 200: { contentType: 'text/event-stream' } }, handler: stub }),
  defineCoreRoute({ path: '/api/dev/events', method: 'GET', summary: 'Dev SSE event stream', description: 'Development-only browser reload and notification event stream.', visibility: 'internal', responses: { 200: { contentType: 'text/event-stream' } }, handler: stub }),
  defineCoreRoute({ path: '/api/dev/notify', method: 'POST', summary: 'Emit development notification', description: 'Development-only watcher bridge for browser rebuild notifications.', visibility: 'internal', body: z.object({ type: z.string(), payload: z.unknown() }), responses: { 200: okResponse }, handler: stub }),
]

// ─── /api/operations (#895) ──────────────────────────────────────────────
const operationView = z.object({ id: z.string(), rev: z.number(), bootId: z.string(), status: z.string() }).passthrough()
const operationsRoutes = [
  defineCoreRoute({ path: '/api/operations', method: 'GET', activityClass: 'routine', summary: 'List operations', description: 'Live and recently finished top-level operations (installs, repairs, reindex, …) with the server boot id.', responses: { 200: z.object({ bootId: z.string(), operations: z.array(operationView) }) }, handler: stub }),
  defineCoreRoute({ path: '/api/operations/:id', method: 'GET', activityClass: 'routine', summary: 'Get an operation', description: 'The complete operation view; `children=1` inlines child views. A 404 carries the boot id so clients can tell expired from restarted.', params: z.object({ id: z.string() }), query: z.object({ children: z.literal('1').optional() }), responses: { 200: z.object({ bootId: z.string(), operation: operationView, children: z.array(operationView).optional() }), 404: z.object({ bootId: z.string(), error: z.literal('not_found') }) }, handler: stub }),
  defineCoreRoute({ path: '/api/operations/:id/cancel', method: 'POST', summary: 'Cancel an operation', description: 'Allowed only before the operation\'s point of no return; terminal status is published after the work settles.', params: z.object({ id: z.string() }), body: { contentType: 'none' }, responses: { 202: z.object({ bootId: z.string(), status: z.literal('cancelling') }), 404: z.object({ bootId: z.string(), status: z.literal('not_found') }), 409: z.object({ bootId: z.string(), status: z.enum(['not_cancellable', 'already_finished']) }) }, handler: stub }),
]

// ─── Aggregate ────────────────────────────────────────────────────────────

export const coreRoutes: ReadonlyArray<APIRoute<any, any, any, any>> = [
  ...agentsRoutes,
  ...dispatchAndPackagesRoutes,
  ...pluginsAndMiscRoutes,
  ...operationsRoutes,
]
