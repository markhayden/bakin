/**
 * Bakin HTTP request handler.
 *
 * The full request router extracted verbatim from server.ts as a factory so the
 * boot orchestration (server.ts) stays small and the routing surface is testable
 * in isolation. Behaviour is byte-for-byte the same ordered if/else dispatch —
 * deps (port, content dir, the OpenAPI source collector) are injected because
 * they close over boot-time state. The declarative-route-table redesign is a
 * deferred follow-up; this is pure relocation.
 */
import type { IncomingMessage, ServerResponse } from 'http'

import { createLogger } from '../logger'
import { getSettings } from '../settings'
import { getBakinPaths, isUsingBakinHome } from '../content-dir'
import { handleSSE, broadcast } from '../sse'
import { BadRequestError, handleJsonPost, jsonResponse } from '../middleware'
import { writeCrossPluginSearchResponse } from '../api-search-handler'
import * as dispatch from '../dispatch'
import { checkAndContinueDependents } from '../continuation'
import * as agents from '../agents'
import { handleMcpRequest } from '../mcp-server'
import { trackResponse } from '../rest-tracking'
import type { ActivityClass } from '../usage'
import {
  resolveRequestActivity,
  type ResolvedRequestActivity,
} from '../rest-activity-class'
import { pluginRegistry } from '../plugin-registry'
import { getCachedOrBuild } from '../../../packages/host/src/api/docs-runtime'
import type { buildOpenApiDocument } from '../../../packages/host/src/api/docs-runtime'
import { dispatchWebHandler } from '../../../packages/host/src/api/_adapter'
import * as activityRoute from '../../../packages/host/src/api/activity'
import * as agentsAvatarRoute from '../../../packages/host/src/api/agents/avatar'
import * as agentsHealthRoute from '../../../packages/host/src/api/agents/health'
import * as agentsSettingsRoute from '../../../packages/host/src/api/agents/settings'
import * as secretsRoute from '../../../packages/host/src/api/secrets'
import * as agentsActionRoute from '../../../packages/host/src/api/agents/[action]'
import * as memoryLogRoute from '../../../packages/host/src/api/memory/log'
import * as pluginSettingsIdRoute from '../../../packages/host/src/api/plugin-settings/[pluginId]'
import * as pluginSettingsSchemasRoute from '../../../packages/host/src/api/plugin-settings/schemas'
import * as pluginsInstallRoute from '../../../packages/host/src/api/plugins/install'
import * as pluginsRemoveRoute from '../../../packages/host/src/api/plugins/remove'
import * as pluginsRestoreRoute from '../../../packages/host/src/api/plugins/restore'
import * as pluginsUpgradeRoute from '../../../packages/host/src/api/plugins/upgrade'
import * as pluginsLinkRoute from '../../../packages/host/src/api/plugins/link'
import * as pluginsUnlinkRoute from '../../../packages/host/src/api/plugins/unlink'
import * as agentPackagesListRoute from '../../../packages/host/src/api/agent-packages/list'
import * as agentPackagesInstallRoute from '../../../packages/host/src/api/agent-packages/install'
import * as agentPackagesDynamicRoute from '../../../packages/host/src/api/agent-packages/dynamic'
import * as contextReportRoute from '../../../packages/host/src/api/context-report/index'
import * as execToolsRoute from '../../../packages/host/src/api/exec-tools/[toolName]'
import * as packagesListRoute from '../../../packages/host/src/api/packages/list'
import * as packagesInstallRoute from '../../../packages/host/src/api/packages/install'
import * as packagesDynamicRoute from '../../../packages/host/src/api/packages/dynamic'
import * as packagesCapabilitiesRoute from '../../../packages/host/src/api/packages/capabilities'
import * as pluginsMemoryAuditRoute from '../../../packages/host/src/api/plugins/memory/audit'
import * as pluginsMemoryWorkspaceRoute from '../../../packages/host/src/api/plugins/memory/workspace'
import * as stateRoute from '../../../packages/host/src/api/state'
import * as assetsRoute from '../../../packages/host/src/api/assets/[...path]'
import * as pluginCatchAllRoute from '../../../packages/host/src/api/plugins/[pluginId]/[[...path]]'
import * as pluginsManifestRoute from '../../../packages/host/src/api/plugins/manifest'
import * as pluginsAssetsRoute from '../../../packages/host/src/api/plugins/assets'
import * as versionRoute from '../../../packages/host/src/api/version'
import * as docsRoute from '../../../packages/host/src/api/docs'
import * as updateStatusRoute from '../../../packages/host/src/api/update/status'
import * as updateApplyRoute from '../../../packages/host/src/api/update/apply'
import { handleDevSse } from '../../../packages/host/src/api/dev/events'
import * as devNotifyRoute from '../../../packages/host/src/api/dev/notify'
import { serveHostClient } from '../../../packages/host/src/api/_static'

const log = createLogger('server')

export interface RequestHandlerDeps {
  port: number
  CONTENT_DIR: string
  collectOpenApiSources: () => Parameters<typeof buildOpenApiDocument>[0]
}

export function createRequestHandler(deps: RequestHandlerDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const { port, CONTENT_DIR, collectOpenApiSources } = deps
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)
    const reqStart = Date.now()

    // Track API requests (skip static assets and Next.js internals)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp')) {
      const activity = requestActivity(req, url)
      trackResponse(req, res, url, reqStart, activity.activityClass, activity.routePattern)
    }

    // MCP endpoint — agent-facing tool server
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      handleMcpRequest(req, res).catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errStack = err instanceof Error ? err.stack : undefined
        log.error('MCP request error', err, { message: errMsg, stack: errStack })
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal MCP error', message: errMsg }))
        }
      })
      return
    }

    // SSE endpoint
    if (url.pathname === '/api/events') {
      handleSSE(req, res)
      return
    }

    // Dev-only routes. Handlers own the BAKIN_DEV gate and return 404
    // when unset — paths are dispatched unconditionally so production
    // gets a clean 404 instead of falling through to the SPA shell.
    if (url.pathname === '/api/dev/events' && req.method === 'GET') {
      handleDevSse(req, res)
      return
    }
    if (url.pathname === '/api/dev/notify' && req.method === 'POST') {
      dispatchWebHandler(req, res, devNotifyRoute.post)
      return
    }

    // Version endpoint
    if (url.pathname === '/api/version' && req.method === 'GET') {
      dispatchWebHandler(req, res, versionRoute.get)
      return
    }

    if (url.pathname === '/api/update/status' && req.method === 'GET') {
      dispatchWebHandler(req, res, updateStatusRoute.get)
      return
    }
    if (url.pathname === '/api/update/apply' && req.method === 'POST') {
      dispatchWebHandler(req, res, updateApplyRoute.post)
      return
    }

    // /api/docs — legacy { routes } shape. Stable contract for CLI
    // consumers (bakin plugins list, bakin docs). Replaced at T17 when
    // the new OpenAPI surface becomes the canonical endpoint and the
    // CLI migrates over.
    if (url.pathname === '/api/docs' && req.method === 'GET') {
      dispatchWebHandler(req, res, docsRoute.get)
      return
    }

    // /api/openapi — live OpenAPI 3.1 document built from the runtime
    // route registry (plugin routes + legacy core RouteDocs until T14–T16
    // migrate them). Cached after first build; the cache is invalidated
    // on plugin hot-reload broadcasts (see plugin-registry hot-reload
    // path) — for now invalidation hooks are placeholders.
    if (url.pathname === '/api/openapi' && req.method === 'GET') {
      const doc = getCachedOrBuild(() => collectOpenApiSources(), port)
      jsonResponse(res, 200, doc as unknown as Record<string, unknown>)
      return
    }

    // Search endpoint — cross-table or per-table adapter search
    if (url.pathname === '/api/search' && req.method === 'GET') {
      writeCrossPluginSearchResponse(url, res).catch((err) => {
        log.error('Search response write failed', err)
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
      })
      return
    }

    // Dispatch endpoint
    if (url.pathname === '/api/dispatch') {
      if (req.method === 'POST') {
        dispatch.dispatchTasks(CONTENT_DIR, port)
          .then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }))
          })
          .catch((err) => {
            log.error('Dispatch failed', err)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
          })
        return
      }
      // GET — return timer state
      const info = dispatch.getDispatchInfo(CONTENT_DIR)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(info))
      return
    }

    // Settings endpoint
    if (url.pathname === '/api/settings') {
      if (req.method === 'GET') {
        jsonResponse(res, 200, getSettings())
        return
      }
      if (req.method === 'POST') {
        handleJsonPost(req, res, async (body) => {
          const { updateSettings } = require('../settings')
          return updateSettings(body)
        })
        return
      }
    }

    // Runtime capability report (P3.2) — the management page's matrix source.
    if (url.pathname === '/api/runtime/capabilities' && req.method === 'GET') {
      ;(async () => {
        const { getAppServices } = require('../app-services') as typeof import('../app-services')
        const { RUNTIME_ADAPTER_NAMES } = require('../runtime-switch') as typeof import('../runtime-switch')
        const runtime = getAppServices().runtime
        return {
          adapter: getSettings().runtime.adapter,
          adapters: RUNTIME_ADAPTER_NAMES,
          runtime: { name: runtime.name, version: runtime.version },
          capabilities: await runtime.capabilities(),
          toolAccess: await runtime.verifyToolAccess(),
          routingSupport: runtime.models.routingSupport(),
          credentialStatus: await runtime.credentialStatus().catch(() => null),
        }
      })()
        .then((payload) => jsonResponse(res, 200, payload))
        .catch((err) => {
          log.error('Runtime capability report failed', err)
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // Runtime onboarding status (P3.3): the ACTIVE runtime's setup state —
    // "configured ✓ / needs setup / remediation" per onboarding component
    // (adapter-inapplicable components report themselves skipped). Backs the
    // management page's switch-time setup surfacing.
    if (url.pathname === '/api/runtime/onboarding' && req.method === 'GET') {
      ;(async () => {
        const { checkAll } = require('../onboarding/index') as typeof import('../onboarding/index')
        return { adapter: getSettings().runtime.adapter, components: await checkAll() }
      })()
        .then((payload) => jsonResponse(res, 200, payload))
        .catch((err) => {
          log.error('Runtime onboarding status failed', err)
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // One-click setup repair from the runtime hub: run a SAFE onboarding
    // component's install() headlessly. Whitelisted — components with
    // interactive prompts or package selection stay CLI/Explore territory.
    if (url.pathname === '/api/runtime/onboarding/install' && req.method === 'POST') {
      handleJsonPost(req, res, async (body) => {
        const name = (body as { component?: string } | null)?.component
        const FIXABLE = new Set(['mkdir', 'settings', 'search', 'search-models', 'plugin-assets', 'agent-sync'])
        if (!name || !FIXABLE.has(name)) {
          throw new Error(`component must be one of: ${[...FIXABLE].join(', ')}`)
        }
        const { COMPONENT_ORDER } = require('../onboarding/index') as typeof import('../onboarding/index')
        const component = COMPONENT_ORDER.find((c) => c.name === name)
        if (!component) throw new Error(`unknown component: ${name}`)
        const result = await component.install({ interactive: false, autoApprove: true, json: false, checkOnly: false, force: false })
        return { ok: result.status !== 'failed', result }
      })
      return
    }

    // Extension trust lane (WS4): inert discovery + allow/revoke through
    // the ONE engine. Feature-detected — a runtime without extensions
    // reports supported: false.
    if (url.pathname === '/api/runtime/extensions' && req.method === 'GET') {
      const { listRuntimeExtensions } = require('../runtime-extensions') as typeof import('../runtime-extensions')
      listRuntimeExtensions()
        .then((report) => jsonResponse(res, 200, report))
        .catch((err) => jsonResponse(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) }))
      return
    }
    if ((url.pathname === '/api/runtime/extensions/allow' || url.pathname === '/api/runtime/extensions/revoke') && req.method === 'POST') {
      const mod = require('../runtime-extensions') as typeof import('../runtime-extensions')
      const action = url.pathname.endsWith('/allow') ? mod.allowRuntimeExtension : mod.revokeRuntimeExtension
      handleJsonPost(req, res, async (body) => {
        const id = (body as { id?: unknown }).id
        if (typeof id !== 'string' || id.length === 0) throw new BadRequestError('id is required')
        try {
          return await action(id)
        } catch (err) {
          // Trust-input errors (unknown id, wrong mode, not-in-allowlist) are
          // caller-recoverable — 400, not a 500.
          if (err instanceof mod.ExtensionTrustError) throw new BadRequestError(err.message)
          throw err
        }
      })
      return
    }

    // Runtime switch (P3.2): runs the full orchestrated lifecycle; progress
    // streams over the activity SSE channel as runtime:switch events. A
    // completed switch requires a server restart to rebind plugin contexts —
    // the result says so, callers surface it.
    if (url.pathname === '/api/runtime/switch' && req.method === 'POST') {
      const { switchRuntime, RuntimeSwitchRequestSchema } = require('../runtime-switch') as typeof import('../runtime-switch')
      handleJsonPost(req, res, async (body) => {
        const parsed = RuntimeSwitchRequestSchema.safeParse(body)
        if (!parsed.success) {
          // Boundary honesty: a malformed preview request must never fail
          // open into a real switch (dryRun: "true" is NOT dryRun: true).
          const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
          throw new BadRequestError(`Invalid runtime switch request — ${detail}`)
        }
        const { target, dryRun, copyWorkspaces, adoptCron } = parsed.data
        const result = await switchRuntime(target, {
          ...(dryRun !== undefined ? { dryRun } : {}),
          ...(copyWorkspaces !== undefined ? { copyWorkspaces } : {}),
          ...(adoptCron !== undefined ? { adoptCron } : {}),
          onProgress: (event) => broadcast({ type: 'runtime:switch', ...event }),
        })
        broadcast({ type: 'runtime:switch:result', ok: result.ok, to: result.to, restartRequired: result.restartRequired })
        return result
      })
      return
    }

    // Provider secret store (Bakin-owned shim keys; write-only/masked)
    if (url.pathname === '/api/secrets') {
      if (req.method === 'GET') {
        dispatchWebHandler(req, res, secretsRoute.get)
        return
      }
      if (req.method === 'POST') {
        dispatchWebHandler(req, res, secretsRoute.post)
        return
      }
      if (req.method === 'DELETE') {
        dispatchWebHandler(req, res, secretsRoute.del)
        return
      }
    }

    // Task dependency continuation
    if (url.pathname === '/api/internal/continuation' && req.method === 'POST') {
      handleJsonPost(req, res, async (body) => {
        const { completedTaskId, completedTitle } = body as { completedTaskId: string; completedTitle: string }
        checkAndContinueDependents(completedTaskId, completedTitle, CONTENT_DIR).catch(err => {
          log.error('Continuation check failed', err)
        })
        return { ok: true }
      })
      return
    }

    // Activity event emission
    if (url.pathname === '/api/activity/emit' && req.method === 'POST') {
      handleJsonPost(req, res, async (payload) => {
        broadcast({ type: 'activity', agent: payload.agent, message: payload.message, ts: payload.ts })
        return { ok: true }
      })
      return
    }

    // Paths endpoint — agents use this to discover content locations
    if (url.pathname === '/api/paths' && req.method === 'GET') {
      const key = url.searchParams.get('key')
      const paths = getBakinPaths()
      if (key) {
        const value = (paths as unknown as Record<string, string>)[key]
        if (value === undefined) {
          jsonResponse(res, 400, { error: `Unknown path key: ${key}. Available: ${Object.keys(paths).join(', ')}` })
        } else {
          jsonResponse(res, 200, { key, path: value })
        }
      } else {
        jsonResponse(res, 200, { paths, isBakinHome: isUsingBakinHome() })
      }
      return
    }

    // Reindex endpoint — per-table or all. Default is REPAIR (resume
    // parked, regenerate engine-missing, migrate drifted, skip healthy);
    // ?force=1 mints fresh generations. Runs a blue/green rebuild either
    // way: queries keep answering from the old physical table while the
    // fresh one backfills; the pointer flips only after convergence (D4).
    // Overlapping calls attach to the running pass (single-flight).
    // ?async=1 returns 202 + a job handle instead of holding the socket
    // across a multi-minute pass; poll GET /api/reindex/status.
    if (url.pathname === '/api/reindex' && req.method === 'POST') {
      const table = url.searchParams.get('table') || undefined
      const force = url.searchParams.get('force') === '1'
      if (url.searchParams.get('async') === '1') {
        const { startReindexJob } = require('../search-registry')
        jsonResponse(res, 202, { job: startReindexJob(table, { force }) })
        return
      }
      const { rebuildRegisteredTables } = require('../search-registry')
      rebuildRegisteredTables(table, { force }).then((results: import('../search-registry').ReindexTableOutcome[]) => {
        const errors = results.filter((r) => r.error).length
        const parked = results.filter((r) => r.result === 'parked').length
        jsonResponse(res, 200, {
          ok: errors === 0 && parked === 0,
          errors,
          parked,
          total: results.reduce((sum, r) => sum + (r.indexed ?? 0), 0),
          tables: results,
        })
      }).catch((err: unknown) => {
        log.error('Rebuild failed', err, { table })
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
      })
      return
    }

    // Full engine reset: stop → wipe derived engine data → clean start →
    // repair reindex (202 + job). Destructive to derived state only; the
    // CLI gates it behind an explicit confirmation.
    if (url.pathname === '/api/search/reset' && req.method === 'POST') {
      const { resetSearchEngine } = require('../search-reset')
      resetSearchEngine().then((result: import('../search-reset').SearchResetResult) => {
        jsonResponse(res, result.ok ? 202 : 409, result)
      }).catch((err: unknown) => {
        log.error('Search engine reset failed', err)
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
      })
      return
    }

    if (url.pathname === '/api/reindex/status' && req.method === 'GET') {
      const { getReindexJobStatus } = require('../search-registry')
      const job = getReindexJobStatus()
      if (!job) {
        jsonResponse(res, 404, { error: 'no reindex job has run since the server started' })
        return
      }
      jsonResponse(res, 200, { job })
      return
    }

    if (url.pathname.startsWith('/api/exec-tools/') && req.method === 'POST') {
      dispatchWebHandler(req, res, execToolsRoute.post)
      return
    }

    // Plugin install/remove endpoints (migrated — see Phase B block below for install)
    if (url.pathname === '/api/plugins/install' && req.method === 'POST') {
      dispatchWebHandler(req, res, pluginsInstallRoute.post)
      return
    }

    if (url.pathname === '/api/plugins/remove' && req.method === 'POST') {
      dispatchWebHandler(req, res, pluginsRemoveRoute.post)
      return
    }

    if (url.pathname === '/api/plugins/restore' && req.method === 'POST') {
      dispatchWebHandler(req, res, pluginsRestoreRoute.post)
      return
    }

    if (url.pathname === '/api/plugins/upgrade' && req.method === 'POST') {
      dispatchWebHandler(req, res, pluginsUpgradeRoute.post)
      return
    }

    if (url.pathname === '/api/plugins/link' && req.method === 'POST') {
      dispatchWebHandler(req, res, pluginsLinkRoute.post)
      return
    }

    if (url.pathname === '/api/plugins/unlink' && req.method === 'POST') {
      dispatchWebHandler(req, res, pluginsUnlinkRoute.post)
      return
    }

    // ─── Agent-package routes (install / list / remove / update / lessons) ──
    // Distinct from the runtime /api/agents/* surface below — see
    // packages/host/src/api/agent-packages/dynamic.ts for the rationale.
    if (url.pathname === '/api/agent-packages' && req.method === 'GET') {
      dispatchWebHandler(req, res, agentPackagesListRoute.get)
      return
    }
    if (url.pathname === '/api/agent-packages/install' && req.method === 'POST') {
      dispatchWebHandler(req, res, agentPackagesInstallRoute.post)
      return
    }
    if (url.pathname.startsWith('/api/agent-packages/') && url.pathname !== '/api/agent-packages/install') {
      dispatchWebHandler(req, res, agentPackagesDynamicRoute.handler)
      return
    }

    // ─── Startup-context diagnostics (#357) — names + numbers, never content ──
    if (url.pathname === '/api/context-report' || url.pathname.startsWith('/api/context-report/')) {
      dispatchWebHandler(req, res, contextReportRoute.handler)
      return
    }

    // ─── Standalone packages routes (skill-pack / workflow-pack / lesson-pack) ──
    if (url.pathname === '/api/packages' && req.method === 'GET') {
      dispatchWebHandler(req, res, packagesListRoute.get)
      return
    }
    if (url.pathname === '/api/packages/install' && req.method === 'POST') {
      dispatchWebHandler(req, res, packagesInstallRoute.post)
      return
    }
    if (url.pathname === '/api/packages/capabilities' && req.method === 'GET') {
      dispatchWebHandler(req, res, packagesCapabilitiesRoute.get)
      return
    }
    if (url.pathname.startsWith('/api/packages/') && url.pathname !== '/api/packages/install') {
      dispatchWebHandler(req, res, packagesDynamicRoute.handler)
      return
    }

    // Agent avatar route (must be before the agent catch-all; migrated — see Phase B block below)
    if (url.pathname === '/api/agents/avatar' && req.method === 'GET') {
      dispatchWebHandler(req, res, agentsAvatarRoute.get)
      return
    }

    // Migrated: /api/agents/health (must be before agent catch-all)
    if (url.pathname === '/api/agents/health' && req.method === 'GET') {
      dispatchWebHandler(req, res, agentsHealthRoute.get)
      return
    }

    // Migrated: /api/agents/settings (must be before agent catch-all)
    if (url.pathname === '/api/agents/settings') {
      if (req.method === 'GET') {
        dispatchWebHandler(req, res, agentsSettingsRoute.get)
        return
      }
      if (req.method === 'PUT') {
        dispatchWebHandler(req, res, agentsSettingsRoute.put)
        return
      }
    }

    // Agent API routes
    if (url.pathname === '/api/agents' && req.method === 'GET') {
      agents.listAgents(CONTENT_DIR).then(list => {
        jsonResponse(res, 200, { agents: list })
      }).catch(err => {
        log.error('List agents failed', err)
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
      })
      return
    }

    // Migrated: /api/agents/{action} — POST start/stop/restart
    if (req.method === 'POST' && /^\/api\/agents\/(start|stop|restart)$/.test(url.pathname)) {
      dispatchWebHandler(req, res, agentsActionRoute.post)
      return
    }

    const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)(\/.*)?$/)
    if (agentMatch) {
      const agentId = agentMatch[1]
      const subPath = agentMatch[2] || ''

      if (subPath === '/status' && req.method === 'GET') {
        agents.getAgentStatus(agentId, CONTENT_DIR).then(status => {
          jsonResponse(res, 200, status)
        }).catch(err => {
          log.error('Agent status fetch failed', err, { agentId })
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
        })
        return
      }

      if (subPath === '/message' && req.method === 'POST') {
        handleJsonPost(req, res, async (body) => {
          const { message } = body as { message: string }
          if (!message) return { ok: false, error: 'Missing message field' }
          return agents.sendMessageToAgent(agentId, message)
        })
        return
      }

      if (subPath === '/tasks' && req.method === 'GET') {
        const tasks = agents.getAgentTasks(agentId, CONTENT_DIR)
        jsonResponse(res, 200, { tasks })
        return
      }

      // Default: agent status
      if (!subPath && req.method === 'GET') {
        agents.getAgentStatus(agentId, CONTENT_DIR).then(status => {
          jsonResponse(res, 200, status)
        }).catch(err => {
          log.error('Agent status fetch failed', err, { agentId })
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
        })
        return
      }
    }

    // ─── Migrated API routes (packages/host/src/api/*) ────────────────
    // These were Next.js App Router route.ts files; migrated in Phase B of #147.
    if (url.pathname === '/api/activity' && req.method === 'GET') {
      dispatchWebHandler(req, res, activityRoute.get)
      return
    }

    if (url.pathname === '/api/memory/log' && req.method === 'POST') {
      dispatchWebHandler(req, res, memoryLogRoute.post)
      return
    }

    if (url.pathname === '/api/plugin-settings/schemas' && req.method === 'GET') {
      dispatchWebHandler(req, res, pluginSettingsSchemasRoute.get)
      return
    }

    // /api/plugins/memory/{audit,workspace} — former standalone
    // routes now served directly (they shadow the plugin catch-all).
    if (url.pathname === '/api/plugins/memory/audit' && req.method === 'GET') {
      dispatchWebHandler(req, res, pluginsMemoryAuditRoute.get)
      return
    }

    if (url.pathname === '/api/plugins/memory/workspace' && req.method === 'GET') {
      dispatchWebHandler(req, res, pluginsMemoryWorkspaceRoute.get)
      return
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      dispatchWebHandler(req, res, stateRoute.get)
      return
    }

    // /api/assets/{...path} — catch-all asset serving (filename-as-identity,
    // range support for video). Must be below narrower /api/assets endpoints
    // (currently none), and before Next.js fallthrough.
    if (url.pathname.startsWith('/api/assets/') && req.method === 'GET') {
      dispatchWebHandler(req, res, assetsRoute.get)
      return
    }

    // /api/plugin-settings/{pluginId} — exclude /schemas (own route)
    {
      const psMatch = url.pathname.match(/^\/api\/plugin-settings\/([^/]+)$/)
      if (psMatch && psMatch[1] !== 'schemas') {
        if (req.method === 'GET') {
          dispatchWebHandler(req, res, pluginSettingsIdRoute.get)
          return
        }
        if (req.method === 'PUT') {
          dispatchWebHandler(req, res, pluginSettingsIdRoute.put)
          return
        }
      }
    }

    // Manifest + asset endpoints for the runtime plugin loader (TF1/TF2).
    // These MUST match before the plugin catch-all (which would otherwise
    // eat `/api/plugins/manifest` as `{pluginId: 'manifest'}`).
    if (url.pathname === '/api/plugins/manifest' && req.method === 'GET') {
      dispatchWebHandler(req, res, pluginsManifestRoute.get)
      return
    }
    if (/^\/api\/plugins\/[^/]+\/assets\//.test(url.pathname) && req.method === 'GET') {
      dispatchWebHandler(req, res, pluginsAssetsRoute.get)
      return
    }

    // Plugin catch-all — /api/plugins/:pluginId/:path* dispatches to each
    // plugin's registered route handlers. Must come LAST among /api/plugins/*
    // dispatches so the more-specific install/remove/legacy memory/manifest/assets
    // routes above win.
    if (
      url.pathname.startsWith('/api/plugins/') &&
      url.pathname !== '/api/plugins/install' &&
      url.pathname !== '/api/plugins/remove' &&
      url.pathname !== '/api/plugins/upgrade' &&
      url.pathname !== '/api/plugins/link' &&
      url.pathname !== '/api/plugins/unlink'
    ) {
      const method = req.method?.toLowerCase() ?? 'get'
      const handler = pluginCatchAllRoute[method === 'delete' ? 'del' : method as 'get' | 'post' | 'put' | 'patch' | 'del']
      if (handler) {
        dispatchWebHandler(req, res, handler)
        return
      }
    }

    // Unmatched /api/* paths are hard 404s for every method — API clients
    // must never receive the SPA shell with a 200, and non-GET requests must
    // never fall through unanswered.
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found', path: url.pathname }))
      return
    }

    // Serve the packages/host client bundle + SPA fallback for any unmatched
    // path. TanStack Router handles route dispatch client-side. serveHostClient
    // declines non-GET/HEAD requests (returns false) — answer those with a 404
    // instead of leaving the connection hanging.
    serveHostClient(req, res, url).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
      }
    }).catch((err) => {
      log.error('Static serve failed', err, { path: url.pathname })
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal server error')
      }
    })
  }
}

/** Resolve explicit route metadata before the delayed response recorder runs. */
export function requestActivityClass(req: IncomingMessage, url: URL): ActivityClass {
  return requestActivity(req, url).activityClass
}

/** Resolve both request intent and its stable registered route pattern. */
export function requestActivity(req: IncomingMessage, url: URL): ResolvedRequestActivity {
  return resolveRequestActivity(
    req.method,
    url.pathname,
    (pluginId) => pluginRegistry.getPluginState(pluginId)?.routes ?? [],
  )
}
