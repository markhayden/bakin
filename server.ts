/**
 * Bakin — Multi-Agent Orchestration Server
 * Version: 1.0.0
 *
 * Main entry point for the Bakin server. Runs on Bun, serves the packages/host
 * client bundle + API handlers. Plugin registry initialization + subsystem
 * boot happen before the HTTP server begins accepting traffic.
 */

import { createServer } from 'http'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

import { MarkdownStorageAdapter } from './src/lib/storage/markdown-adapter'
import { BakinEventBus } from './src/lib/events/event-bus'
import { pluginRegistry, registerCorePlugins } from './src/lib/plugin-registry'
import { CORE_PLUGIN_IMPORTS } from './src/lib/plugin-static-imports'
import config from './bakin.config'

// Give the registry the static core-plugin table. Done here, not in
// plugin-registry.ts, so the plugins only live in server.ts's module
// graph — tests that import the registry don't drag every plugin +
// every plugin-level side effect (watchers, runtime path access) into
// their module load.
registerCorePlugins(CORE_PLUGIN_IMPORTS)

import { createLogger } from './src/core/logger'
import { getSettings } from './src/core/settings'
import { getContentDir, getBakinPaths, isUsingBakinHome } from './src/core/content-dir'
import { handleSSE, broadcast } from './src/core/sse'
import { appendAudit } from './src/core/audit'
import { createAppServices } from './src/core/app-services'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { handleJsonPost, jsonResponse } from './src/core/middleware'
import { writeCrossPluginSearchResponse } from './src/core/api-search-handler'
import * as watcher from './src/core/watcher'
import * as dispatch from './src/core/dispatch'
import * as watchdog from './src/core/watchdog'
import { runRestartRecovery } from './src/core/restart-recovery'
import { registerShutdownHandlers } from './src/core/lifecycle'
import { checkAndContinueDependents } from './src/core/continuation'
import { getAllRoutes, generateDocs } from './src/core/api-docs'
import { getCachedOrBuild } from './packages/host/src/api/docs-runtime'
import type { buildOpenApiDocument } from './packages/host/src/api/docs-runtime'
import { collectOpenApiSources as collectTypedOpenApiSources } from './packages/host/src/api/openapi-sources'
import { migrateIfNeeded } from './src/core/search-migration'
import * as agents from './src/core/agents'
import * as doctor from './src/core/doctor'
import { handleMcpRequest } from './src/core/mcp-server'
import * as mcporter from './src/core/mcporter'
import { trackResponse } from './src/core/rest-tracking'
import { dispatchWebHandler } from './packages/host/src/api/_adapter'
import * as activityRoute from './packages/host/src/api/activity'
import * as agentsAvatarRoute from './packages/host/src/api/agents/avatar'
import * as agentsHealthRoute from './packages/host/src/api/agents/health'
import * as agentsSettingsRoute from './packages/host/src/api/agents/settings'
import * as secretsRoute from './packages/host/src/api/secrets'
import * as agentsActionRoute from './packages/host/src/api/agents/[action]'
import * as memoryLogRoute from './packages/host/src/api/memory/log'
import * as pluginSettingsIdRoute from './packages/host/src/api/plugin-settings/[pluginId]'
import * as pluginSettingsSchemasRoute from './packages/host/src/api/plugin-settings/schemas'
import * as pluginsInstallRoute from './packages/host/src/api/plugins/install'
import * as pluginsRemoveRoute from './packages/host/src/api/plugins/remove'
import * as pluginsRestoreRoute from './packages/host/src/api/plugins/restore'
import * as pluginsUpgradeRoute from './packages/host/src/api/plugins/upgrade'
import * as pluginsLinkRoute from './packages/host/src/api/plugins/link'
import * as pluginsUnlinkRoute from './packages/host/src/api/plugins/unlink'
import * as agentPackagesListRoute from './packages/host/src/api/agent-packages/list'
import * as agentPackagesInstallRoute from './packages/host/src/api/agent-packages/install'
import * as agentPackagesDynamicRoute from './packages/host/src/api/agent-packages/dynamic'
import * as execToolsRoute from './packages/host/src/api/exec-tools/[toolName]'
import * as packagesListRoute from './packages/host/src/api/packages/list'
import * as packagesInstallRoute from './packages/host/src/api/packages/install'
import * as packagesDynamicRoute from './packages/host/src/api/packages/dynamic'
import * as curatedListRoute from './packages/host/src/api/curated/list'
import * as pluginsMemoryAuditRoute from './packages/host/src/api/plugins/memory/audit'
import * as pluginsMemoryWorkspaceRoute from './packages/host/src/api/plugins/memory/workspace'
import * as stateRoute from './packages/host/src/api/state'
import * as assetsRoute from './packages/host/src/api/assets/[...path]'
import * as pluginCatchAllRoute from './packages/host/src/api/plugins/[pluginId]/[[...path]]'
import * as pluginsManifestRoute from './packages/host/src/api/plugins/manifest'
import * as pluginsAssetsRoute from './packages/host/src/api/plugins/assets'
import * as updateStatusRoute from './packages/host/src/api/update/status'
import * as updateApplyRoute from './packages/host/src/api/update/apply'
import { handleDevSse } from './packages/host/src/api/dev/events'
import * as devNotifyRoute from './packages/host/src/api/dev/notify'
import { serveHostClient } from './packages/host/src/api/_static'
import { buildAllUserPlugins } from './packages/host/src/plugin-host/user-plugin-builder'
import { dispatchCli } from './src/core/cli'
import { setEmbeddedAssets } from './packages/host/src/api/_embedded-assets'
// Generated module — pulls in every core asset via `with { type: 'file' }`
// so `bun build --compile` embeds their bytes. Only imported from server.ts
// so tests don't drag these imports through vite's transform pipeline.
import { EMBEDDED_ASSETS_STATIC } from './packages/host/src/api/_embedded-assets-static'

setEmbeddedAssets(EMBEDDED_ASSETS_STATIC)

const log = createLogger('server')

import { APP_VERSION } from './packages/core/src/constants'

const BAKIN_VERSION = APP_VERSION

// Parse argv and run one-shot subcommands (`version`, `stop`, `status`,
// `plugins ...`, `update`, `--help`) before touching the filesystem.
// Only `start` (the default) continues past this point. See
// src/core/cli.ts for the command table.
{
  const cliResult = await dispatchCli(process.argv)
  if (!cliResult.startServer) {
    process.exit(cliResult.exitCode)
  }
}

const port = Number(process.env.PORT || 3737)
const CONTENT_DIR = getContentDir()
const SEARCH_STARTUP_RETRY_MS = 5000

/**
 * Build the source list the OpenAPI runtime builder consumes from the
 * live route registry. Plugin routes come from pluginRegistry; core routes
 * come from the typed core route declarations so body/query/response schemas
 * are preserved in live `/api/openapi`.
 */
function collectOpenApiSources(): Parameters<typeof buildOpenApiDocument>[0] {
  return collectTypedOpenApiSources(pluginRegistry.getAllPluginRoutes())
}

type SearchMigrationResult = Awaited<ReturnType<typeof migrateIfNeeded>>

async function runSearchStartupBootstrap(
  migration: SearchMigrationResult,
  opts: { retry?: boolean } = {},
): Promise<boolean> {
  const {
    createRegisteredTables,
    reindexContentTypes,
    runPendingReconciles,
  } = await import('./src/core/search-registry')

  const tableSetup = await createRegisteredTables()
  if (tableSetup.failures.length > 0) {
    const message = opts.retry
      ? 'Deferred search table setup still failing; startup reconcile and reindex remain paused'
      : 'Search table setup incomplete; pausing startup reconcile and reindex until tables are ready'
    log.warn(message, { failures: tableSetup.failures })
    return false
  }

  // Drain any startup reconciles enqueued by registerFileBackedContentType.
  // Tables exist by this point so reconcile scans hit real data. Failures
  // are logged inside the helper and do not block startup.
  await runPendingReconciles()

  // If the schema migration dropped tables, kick off a full background
  // reindex so the freshly-recreated tables get populated with content.
  // Fire-and-forget: Bakin is usable immediately with empty tables;
  // indexing completes in the background and streams progress over SSE.
  if (migration.migrated) {
    const message = opts.retry
      ? 'Running deferred full reindex after schema migration'
      : 'Running full reindex after schema migration'
    log.info(message, {
      from: migration.from,
      to: migration.to,
    })
    reindexContentTypes().then((results) => {
      const total = results.reduce((sum: number, r) => sum + (r.indexed || 0), 0)
      log.info('Schema migration reindex complete', { tables: results.length, total })
    }).catch((err) => {
      log.error('Schema migration reindex failed', err)
    })
  }

  return true
}

// Ensure required directories exist
for (const dir of [CONTENT_DIR, join(CONTENT_DIR, 'heartbeats'), join(CONTENT_DIR, 'inbox')]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// Plugin infrastructure
const storage = new MarkdownStorageAdapter(CONTENT_DIR)
const eventBus = new BakinEventBus(broadcast)

;(async () => {
  // Initialize the adapter/task service spine before plugin activation.
  const appServices = await createAppServices()

  // Rebuild any stale user plugin dist/ before the registry imports them.
  // User plugins activate only from `<pluginDir>/dist/index.js`; source
  // entries are build inputs, not runtime entrypoints.
  // Failures inside `buildAllUserPlugins` are logged; they don't block
  // startup — the registry will surface a clearer error on import.
  const userPluginsDir = join(CONTENT_DIR, 'plugins')
  await buildAllUserPlugins(userPluginsDir, log)

  // Initialize plugin registry
  log.info('Loading plugins...')
  await pluginRegistry.initialize(config, storage, eventBus, appServices)

  // Layer agent-package contributions on top of plugin-registered workflows +
  // workflow-skills. Plugins have populated the `plugin` tier of the workflow
  // source-registry / skill-loader; agent-packages now populate the
  // `agent-package` tier (precedence: user > agent-package > plugin). User
  // files on disk get loaded by their own paths and always win on top.
  // Failures are logged inside the helper — never block boot.
  const { loadAgentPackageSources } = await import('./src/core/agent-packages/load-sources')
  loadAgentPackageSources()

  // Expose registry accessors on globalThis so Next.js API routes (which get
  // separate webpack-compiled module instances) can read the real data.
  ;(globalThis as any).__bakinGetRegistrySnapshot = () => pluginRegistry.getRegistrySnapshot()

  // Check the search schema version and drop stale bakin_* tables when
  // the in-code version has advanced beyond the last-migrated version.
  // The registry recreates the tables below via createRegisteredTables,
  // and we trigger a full reindex after plugins are ready.
  const migration = await migrateIfNeeded()

  const searchBootstrapReady = await runSearchStartupBootstrap(migration)
  if (!searchBootstrapReady) {
    setTimeout(() => {
      runSearchStartupBootstrap(migration, { retry: true }).catch((err) => {
        log.warn('Deferred search startup retry failed', err)
      })
    }, SEARCH_STARTUP_RETRY_MS)
  }

  // Start periodic orphan cleanup for search indexes
  const { startCleanupTimer } = await import('./src/core/search-cleanup')
  startCleanupTimer()

  // Register search sync hook with file watcher
  // Legacy syncFile/syncFileUnlink removed — plugins now handle their own
  // indexing via ctx.search.index() / ctx.search.remove() with correct schemas

  // Generate API docs
  generateDocs(CONTENT_DIR)

  // Create inbox handler using the configured runtime adapter.
  const handleInboxFile = watcher.createInboxHandler({
    contentDir: CONTENT_DIR,
    sendNotification: (message: string) => {
      getRuntimeMainAgentId(appServices.runtime)
        .then((agentId) => appServices.runtime.messaging.send({ agentId, content: message }))
        .catch(err => {
          log.error('Failed to notify main agent of completion', err)
        })
    },
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)
    const reqStart = Date.now()

    // Track API requests (skip static assets and Next.js internals)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp')) {
      trackResponse(req, res, url, reqStart)
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
      jsonResponse(res, 200, { version: BAKIN_VERSION })
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
      jsonResponse(res, 200, { routes: getAllRoutes() })
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
          const { updateSettings } = require('./src/core/settings')
          return updateSettings(body)
        })
        return
      }
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

    // Reindex endpoint — per-table or all, with optional rebuild and verify
    if (url.pathname === '/api/reindex' && req.method === 'POST') {
      const { reindexContentTypes } = require('./src/core/search-registry')
      const table = url.searchParams.get('table') || undefined
      const rebuild = url.searchParams.get('rebuild') === 'true'
      const verify = url.searchParams.get('verify') === 'true'
      reindexContentTypes({ table, rebuild, verify }).then((results: Array<Record<string, unknown>>) => {
        const total = results.reduce((sum: number, r: Record<string, unknown>) => sum + (r.indexed as number || 0), 0)
        const errors = results.filter((r) => r.error).length
        const enrichmentErrors = results.filter((r) => {
          const enrichment = r.enrichment as { healthy?: boolean } | undefined
          return enrichment && !enrichment.healthy
        }).length
        jsonResponse(res, 200, {
          ok: errors === 0 && enrichmentErrors === 0,
          total,
          errors,
          enrichmentErrors,
          tables: results,
        })
      }).catch((err: unknown) => {
        log.error('Reindex failed', err, { table, rebuild })
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
      })
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

    // ─── Standalone packages routes (skill-pack / workflow-pack / lesson-pack) ──
    if (url.pathname === '/api/packages' && req.method === 'GET') {
      dispatchWebHandler(req, res, packagesListRoute.get)
      return
    }
    if (url.pathname === '/api/packages/install' && req.method === 'POST') {
      dispatchWebHandler(req, res, packagesInstallRoute.post)
      return
    }
    if (url.pathname.startsWith('/api/packages/') && url.pathname !== '/api/packages/install') {
      dispatchWebHandler(req, res, packagesDynamicRoute.handler)
      return
    }

    // ─── Curated catalog (binary-embedded suggestions) ───────────────
    if (url.pathname === '/api/curated' && req.method === 'GET') {
      dispatchWebHandler(req, res, curatedListRoute.get)
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

    // Serve the packages/host client bundle + SPA fallback for any unmatched
    // path. TanStack Router handles route dispatch client-side.
    serveHostClient(req, res, url).catch((err) => {
      log.error('Static serve failed', err, { path: url.pathname })
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal server error')
      }
    })
  })

  // Setup mcporter (install if needed + sync per-agent config)
  try {
    await mcporter.setup(port)
  } catch (err) {
    log.warn('mcporter setup failed — agents can still use REST/CLI', err)
  }

  // Start file watching before the server loops. Dispatch/watchdog wait until
  // restart recovery has taken the first look at stale in-progress tasks.
  watcher.start({ contentDir: CONTENT_DIR, eventBus, onInboxFile: handleInboxFile })

  // Notify all plugins that every plugin is now active
  await pluginRegistry.onAllReady()

  // Register graceful shutdown
  registerShutdownHandlers(server, CONTENT_DIR)

  // Write initial dispatch state
  const dispatchState = dispatch.loadDispatchState(CONTENT_DIR)
  dispatchState.serverStart = Date.now()

  server.listen(port, '0.0.0.0', () => {
    log.info(`Bakin ready on http://localhost:${port}`)
    log.info(`Listening on 0.0.0.0:${port} (Tailscale: http://100.91.112.69:${port})`)
    if (process.env.BAKIN_DEV === '1') {
      const logPath = join(getBakinPaths().logs, 'server.log')
      log.info(`Full logs: ${logPath}`, { path: logPath })
    }

    void (async () => {
      let recovered = 0
      try {
        const result = await runRestartRecovery(CONTENT_DIR)
        recovered = result.recovered
      } catch (err) {
        log.error('Restart recovery failed', err)
      } finally {
        dispatch.start(CONTENT_DIR, port)
        watchdog.start(CONTENT_DIR)
      }

      try {
        if (recovered > 0) {
          await dispatch.dispatchTasks(CONTENT_DIR, port)
        }
      } catch (err) {
        log.error('Post-recovery dispatch failed', err)
      } finally {
        doctor.start(CONTENT_DIR, process.cwd())
      }

      if (process.env.BAKIN_SEED_USAGE === '1') {
        import('./dev/imitation-crab/usage-seed')
          .then(m => m.seedMockUsage())
          .catch(err => log.warn('Mock usage seed failed', err))
      }
    })()
  })

  // Hot-reload coordinator (Phase 2 P2.C8). Enabled by `bakin dev`
  // (BAKIN_DEV=1) or explicitly via BAKIN_DEV_HOTRELOAD=1 so the
  // compiled production binary doesn't pull chokidar into its module graph.
  if (process.env.BAKIN_DEV === '1' || process.env.BAKIN_DEV_HOTRELOAD === '1') {
    try {
      const { startHotReloadCoordinator } = await import('./src/core/plugin-host/hot-reload-coordinator')
      startHotReloadCoordinator()
    } catch (err) {
      log.error('Failed to start hot-reload coordinator', err as Error)
    }
  }

  // Audit system init
  appendAudit(CONTENT_DIR, 'system.init', 'system', {})
})()
