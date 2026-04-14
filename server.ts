/**
 * Bakin — Multi-Agent Orchestration Server
 * Version: 1.0.0
 * Last updated: 2026-03-28
 *
 * Main entry point for the Bakin server. Bootstraps Next.js,
 * registers plugins, and starts the HTTP server with API routing.
 */

import { createServer } from 'http'
import next from 'next'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'

import { MarkdownStorageAdapter } from './src/lib/storage/markdown-adapter'
import { BakinEventBus } from './src/lib/events/event-bus'
import { pluginRegistry } from './src/lib/plugin-registry'
import config from './bakin.config'

import { createLogger } from './src/core/logger'
import { getSettings } from './src/core/settings'
import { getContentDir, getBakinPaths, isUsingBakinHome } from './src/core/content-dir'
import { handleSSE, broadcast } from './src/core/sse'
import { appendAudit } from './src/core/audit'
import * as vault from './src/core/vault'
import * as openclaw from './src/core/openclaw-client'
import { getMainAgentId } from './src/core/main-agent'
import { handleJsonPost, jsonResponse } from './src/core/middleware'
import * as watcher from './src/core/watcher'
import * as dispatch from './src/core/dispatch'
import * as watchdog from './src/core/watchdog'
import * as messagingCron from './src/core/messaging-cron'
import { registerShutdownHandlers } from './src/core/lifecycle'
import { checkAndContinueDependents } from './src/core/continuation'
import { getAllRoutes, generateDocs } from './src/core/api-docs'
import * as antfly from './src/core/antfly'
import * as antflyServer from './src/core/antfly-server'
import { migrateIfNeeded } from './src/core/search-migration'
import * as agents from './src/core/agents'
import * as pluginInstaller from './src/core/plugin-installer'
import * as doctor from './src/core/doctor'
import { handleMcpRequest } from './src/core/mcp-server'
import * as mcporter from './src/core/mcporter'
import { recordRequest } from './src/core/request-log'

const log = createLogger('server')

import { APP_VERSION } from './packages/core/src/constants'

const BAKIN_VERSION = APP_VERSION

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT || 3737)
const CONTENT_DIR = getContentDir()

const app = next({ dev })
const handle = app.getRequestHandler()

// Ensure required directories exist
for (const dir of [CONTENT_DIR, join(CONTENT_DIR, 'heartbeats'), join(CONTENT_DIR, 'inbox')]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// Plugin infrastructure
const storage = new MarkdownStorageAdapter(CONTENT_DIR)
const eventBus = new BakinEventBus(broadcast)

app.prepare().then(async () => {
  // Initialize vault (load credentials from disk)
  vault.initialize()

  // Load settings (initializes with defaults if no settings file)
  const settings = getSettings()

  // Initialize plugin registry
  log.info('Loading plugins...')
  await pluginRegistry.initialize(config, storage, eventBus)

  // Expose registry accessors on globalThis so Next.js API routes (which get
  // separate webpack-compiled module instances) can read the real data.
  ;(globalThis as any).__bakinGetRegistrySnapshot = () => pluginRegistry.getRegistrySnapshot()
  ;(globalThis as any).__bakinGetExecToolStats = () => {
    const { getExecToolStats } = require('./scripts/lib/registry')
    return getExecToolStats()
  }

  // Start Antfly server if enabled (auto-manages the process)
  await antflyServer.start()

  // Initialize Antfly client (optional — no-op if disabled in settings)
  await antfly.initialize()

  // Check the search schema version and drop stale bakin_* tables when
  // the in-code version has advanced beyond the last-migrated version.
  // The registry recreates the tables below via createRegisteredTables,
  // and we trigger a full reindex after plugins are ready.
  const migration = await migrateIfNeeded()

  // Register audit content type for search (core module, not a plugin)
  const { createRegisteredTables, buildSearchAPI, runPendingReconciles } = await import('./src/core/search-registry')
  const auditSearch = buildSearchAPI('_audit')
  auditSearch.registerContentType({
    table: 'audit',
    schema: {
      event: { type: 'keyword' },
      agent: { type: 'keyword' },
      channel: { type: 'keyword' },
      content: { type: 'text' },
      created_at: { type: 'datetime' },
    },
    searchableFields: ['content', 'event'],
    rerankField: 'content',
    embeddingTemplate: '{{event}} {{agent}} {{content}}',
    facets: ['event', 'agent', 'channel'],
    ttl: settings.antfly.auditTtl,
    ttlField: 'created_at',
    reindex: async function* () {
      // Read audit.jsonl and yield each entry
      const { createReadStream } = await import('fs')
      const { createInterface } = await import('readline')
      const auditPath = join(CONTENT_DIR, 'audit.jsonl')
      if (!existsSync(auditPath)) return
      const rl = createInterface({ input: createReadStream(auditPath) })
      for await (const line of rl) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line)
          const key = `audit-${entry.ts}-${entry.event}`
          yield {
            key,
            doc: {
              event: entry.event,
              agent: entry.agent,
              channel: entry.channel || '',
              content: `[${entry.ts}] ${entry.event} by ${entry.agent}: ${JSON.stringify(entry.data || {})}`,
              created_at: entry.ts,
            },
          }
        } catch { /* skip malformed lines */ }
      }
    },
    verifyExists: async () => true, // audit entries are append-only, never deleted
  })

  // Create Antfly tables for all registered search content types
  await createRegisteredTables()

  // Drain any startup reconciles enqueued by registerFileBackedContentType.
  // Tables exist by this point so reconcile scans hit real data. Failures
  // are logged inside the helper — never block startup.
  await runPendingReconciles()

  // If the schema migration dropped tables, kick off a full background
  // reindex so the freshly-recreated tables get populated with content.
  // Fire-and-forget — Bakin is usable immediately with empty tables;
  // indexing completes in the background and streams progress over SSE.
  if (migration.migrated) {
    log.info('Running full reindex after schema migration', {
      from: migration.from,
      to: migration.to,
    })
    const { reindexContentTypes } = await import('./src/core/search-registry')
    reindexContentTypes().then((results) => {
      const total = results.reduce((sum: number, r) => sum + (r.indexed || 0), 0)
      log.info('Schema migration reindex complete', { tables: results.length, total })
    }).catch((err) => {
      log.error('Schema migration reindex failed', err)
    })
  }

  // Start periodic orphan cleanup for search indexes
  const { startCleanupTimer } = await import('./src/core/search-cleanup')
  startCleanupTimer()

  // Register Antfly sync hook with file watcher
  // Legacy syncFile/syncFileUnlink removed — plugins now handle their own
  // indexing via ctx.search.index() / ctx.search.remove() with correct schemas

  // Generate API docs
  generateDocs(CONTENT_DIR)

  // Create inbox handler using OpenClaw HTTP client
  const handleInboxFile = watcher.createInboxHandler({
    contentDir: CONTENT_DIR,
    sendNotification: (message: string) => {
      openclaw.sendMessage(getMainAgentId(), message).catch(err => {
        log.error('Failed to notify main agent of completion', err)
      })
    },
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)
    const reqStart = Date.now()

    // Track API requests (skip static assets and Next.js internals)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp')) {
      const origEnd = res.end.bind(res)
      res.end = function (...args: Parameters<typeof res.end>) {
        const path = url.pathname.replace(/\?.*/, '')
        recordRequest({
          ts: new Date().toISOString(),
          method: req.method || 'GET',
          path,
          status: res.statusCode,
          durationMs: Date.now() - reqStart,
          agent: url.searchParams.get('agent') || undefined,
        })
        return origEnd(...args)
      } as typeof res.end
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

    // Version endpoint
    if (url.pathname === '/api/version' && req.method === 'GET') {
      jsonResponse(res, 200, { version: BAKIN_VERSION })
      return
    }

    // API docs endpoint
    if (url.pathname === '/api/docs' && req.method === 'GET') {
      jsonResponse(res, 200, { routes: getAllRoutes() })
      return
    }

    // Search endpoint — cross-table or per-table Antfly search
    if (url.pathname === '/api/search' && req.method === 'GET') {
      const query = url.searchParams.get('q')
      if (!query) {
        jsonResponse(res, 400, { error: 'Missing ?q= parameter' })
        return
      }
      const { crossTableSearch } = require('./src/core/search-registry')
      crossTableSearch(query, {
        table: url.searchParams.get('table') || undefined,
        limit: Number(url.searchParams.get('limit')) || undefined,
        offset: Number(url.searchParams.get('offset')) || undefined,
        facets: url.searchParams.get('facets')?.split(',').filter(Boolean) || undefined,
      }).then((response: Record<string, unknown>) => {
        jsonResponse(res, 200, response)
      }).catch((err: unknown) => {
        log.error('Search request failed', err)
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

    // Task dependency continuation
    if (url.pathname === '/api/internal/continuation' && req.method === 'POST') {
      handleJsonPost(req, res, async (body) => {
        const { completedTaskId, completedTitle } = body as { completedTaskId: string; completedTitle: string }
        checkAndContinueDependents(completedTaskId, completedTitle, CONTENT_DIR, port).catch(err => {
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

    // Antfly health endpoint
    if (url.pathname === '/api/antfly/health' && req.method === 'GET') {
      const { getSearchHealth } = require('./src/core/search-registry')
      getSearchHealth().then((health: Record<string, unknown>) => {
        jsonResponse(res, 200, health)
      }).catch((err: unknown) => {
        log.error('Antfly health check failed', err)
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
      })
      return
    }

    // Plugin install/remove endpoints
    if (url.pathname === '/api/plugins/install' && req.method === 'POST') {
      handleJsonPost(req, res, async (body) => {
        const { source, type } = body as { source: string; type: 'local' | 'github' }
        if (type === 'github') {
          return pluginInstaller.installFromGithub(source, process.cwd())
        }
        return pluginInstaller.installFromPath(source, process.cwd())
      })
      return
    }

    if (url.pathname === '/api/plugins/remove' && req.method === 'POST') {
      handleJsonPost(req, res, async (body) => {
        const { pluginId } = body as { pluginId: string }
        return pluginInstaller.removePlugin(pluginId, process.cwd())
      })
      return
    }

    // Agent avatar route (must be before the agent catch-all)
    if (url.pathname === '/api/agents/avatar' && req.method === 'GET') {
      const agentId = url.searchParams.get('id')
      if (!agentId) {
        jsonResponse(res, 400, { error: 'Missing id param' })
        return
      }
      const avatarPath = join(CONTENT_DIR, 'agents', agentId, 'avatar.jpg')
      if (!existsSync(avatarPath)) {
        res.writeHead(404)
        res.end()
        return
      }
      const data = readFileSync(avatarPath)
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      })
      res.end(data)
      return
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

    // Let Next.js handle everything else
    handle(req, res)
  })

  // Setup mcporter (install if needed + sync per-agent config)
  try {
    mcporter.setup(port)
  } catch (err) {
    log.warn('mcporter setup failed — agents can still use REST/CLI', err)
  }

  // Start all subsystems
  watcher.start({ contentDir: CONTENT_DIR, eventBus, onInboxFile: handleInboxFile })
  dispatch.start(CONTENT_DIR, port)
  dispatch.reconcileOnStartup(CONTENT_DIR)
  // messagingCron.start(CONTENT_DIR, port) — deprecated: schedule plugin bridge replaces this
  watchdog.start(CONTENT_DIR, port)
  doctor.start(CONTENT_DIR, process.cwd())

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
  })

  // Audit system init
  appendAudit(CONTENT_DIR, 'system.init', 'system', {})
})
