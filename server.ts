/**
 * Beacon — Mission Control Server
 * Version: 1.0.0
 * Last updated: 2026-03-21
 * 
 * Main entry point for the Beacon server. Bootstraps Next.js,
 * registers plugins, and starts the HTTP server with API routing.
 */

import { createServer } from 'http'
import next from 'next'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'

import { MarkdownStorageAdapter } from './src/lib/storage/markdown-adapter'
import { MCEventBus } from './src/lib/events/event-bus'
import { pluginRegistry } from './src/lib/plugin-registry'
import config from './mc.config'

import { createLogger } from './src/core/logger'
import { getSettings } from './src/core/settings'
import { getContentDir, getBeaconPaths, isUsingBeaconHome } from './src/core/content-dir'
import { handleSSE, broadcast } from './src/core/sse'
import { appendAudit } from './src/core/audit'
import * as vault from './src/core/vault'
import * as openclaw from './src/core/openclaw-client'
import { handleJsonPost, jsonResponse } from './src/core/middleware'
import * as watcher from './src/core/watcher'
import * as dispatch from './src/core/dispatch'
import * as watchdog from './src/core/watchdog'
import * as calendarCron from './src/core/calendar-cron'
import { registerShutdownHandlers } from './src/core/lifecycle'
import { checkAndContinueDependents } from './src/core/continuation'
import { getAllRoutes, generateDocs } from './src/core/api-docs'
import * as antfly from './src/core/antfly'
import * as antflyServer from './src/core/antfly-server'
import * as agents from './src/core/agents'
import * as pluginInstaller from './src/core/plugin-installer'
import * as doctor from './src/core/doctor'
import { handleMcpRequest } from './src/core/mcp-server'
import * as mcporter from './src/core/mcporter'
import { recordRequest } from './src/core/request-log'

const log = createLogger('server')

// Git version — computed once at startup
let BEACON_VERSION = 'unknown'
try {
  const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  const dirty = execSync('git status --porcelain', { encoding: 'utf-8' }).trim() ? '-dirty' : ''
  BEACON_VERSION = `${hash}${dirty}`
} catch { /* not a git repo or git not installed */ }

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
const eventBus = new MCEventBus(broadcast)

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
  ;(globalThis as any).__beaconGetRegistrySnapshot = () => pluginRegistry.getRegistrySnapshot()
  ;(globalThis as any).__beaconGetExecToolStats = () => {
    const { getExecToolStats } = require('./scripts/lib/registry')
    return getExecToolStats()
  }

  // Start Antfly server if enabled (auto-manages the process)
  await antflyServer.start()

  // Initialize Antfly client (optional — no-op if disabled in settings)
  await antfly.initialize()

  // Register Antfly sync hook with file watcher
  watcher.registerSyncHook(antfly.syncFile)

  // Generate API docs
  generateDocs(CONTENT_DIR)

  // Create inbox handler using OpenClaw HTTP client
  const handleInboxFile = watcher.createInboxHandler({
    contentDir: CONTENT_DIR,
    sendNotification: (message: string) => {
      openclaw.sendMessage('main', message).catch(err => {
        log.error('Failed to notify roscoe of completion', err)
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
        log.error('MCP request error', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal MCP error' }))
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
      jsonResponse(res, 200, { version: BEACON_VERSION })
      return
    }

    // API docs endpoint
    if (url.pathname === '/api/docs' && req.method === 'GET') {
      jsonResponse(res, 200, { routes: getAllRoutes() })
      return
    }

    // Search endpoint (Antfly-powered when enabled)
    if (url.pathname === '/api/search' && req.method === 'GET') {
      const query = url.searchParams.get('q')
      if (!query) {
        jsonResponse(res, 400, { error: 'Missing ?q= parameter' })
        return
      }
      antfly.search(query, {
        table: url.searchParams.get('table') || undefined,
        limit: Number(url.searchParams.get('limit')) || undefined,
        agent: url.searchParams.get('agent') || undefined,
      }).then(results => {
        jsonResponse(res, 200, { results, enabled: antfly.enabled() })
      }).catch(err => {
        jsonResponse(res, 500, { error: String(err) })
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
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: String(err) }))
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
      const paths = getBeaconPaths()
      if (key) {
        const value = (paths as unknown as Record<string, string>)[key]
        if (value === undefined) {
          jsonResponse(res, 400, { error: `Unknown path key: ${key}. Available: ${Object.keys(paths).join(', ')}` })
        } else {
          jsonResponse(res, 200, { key, path: value })
        }
      } else {
        jsonResponse(res, 200, { paths, isBeaconHome: isUsingBeaconHome() })
      }
      return
    }

    // Doctor endpoint — returns cached results by default, ?fresh=true forces re-run
    if (url.pathname === '/api/doctor') {
      if (req.method === 'GET' || req.method === 'POST') {
        const fresh = url.searchParams.get('fresh') === 'true' || req.method === 'POST'
        if (!fresh) {
          const cached = doctor.getLastResults()
          if (cached) {
            const results = cached.results
            const errors = results.filter(r => r.status === 'error').length
            const warnings = results.filter(r => r.status === 'warn').length
            jsonResponse(res, 200, { results, summary: { total: results.length, errors, warnings }, cachedAt: new Date(cached.timestamp).toISOString() })
            return
          }
        }
        doctor.runDiagnostics(CONTENT_DIR, process.cwd()).then(results => {
          const errors = results.filter(r => r.status === 'error').length
          const warnings = results.filter(r => r.status === 'warn').length
          jsonResponse(res, 200, { results, summary: { total: results.length, errors, warnings } })
        }).catch(err => {
          jsonResponse(res, 500, { error: String(err) })
        })
        return
      }
    }

    // Reindex endpoint (triggers Antfly full reindex)
    if (url.pathname === '/api/reindex' && req.method === 'POST') {
      antfly.reindexAll(CONTENT_DIR).then(count => {
        jsonResponse(res, 200, { ok: true, indexed: count })
      }).catch(err => {
        jsonResponse(res, 500, { error: String(err) })
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

    // Agent API routes
    if (url.pathname === '/api/agents' && req.method === 'GET') {
      agents.listAgents(CONTENT_DIR).then(list => {
        jsonResponse(res, 200, { agents: list })
      }).catch(err => {
        jsonResponse(res, 500, { error: String(err) })
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
          jsonResponse(res, 500, { error: String(err) })
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
          jsonResponse(res, 500, { error: String(err) })
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
  // calendarCron.start(CONTENT_DIR, port) — deprecated: schedule plugin bridge replaces this
  watchdog.start(CONTENT_DIR, port)
  doctor.start(CONTENT_DIR, process.cwd())

  // Register graceful shutdown
  registerShutdownHandlers(server, CONTENT_DIR)

  // Write initial dispatch state
  const dispatchState = dispatch.loadDispatchState(CONTENT_DIR)
  dispatchState.serverStart = Date.now()

  server.listen(port, '0.0.0.0', () => {
    log.info(`Beacon ready on http://0.0.0.0:${port}`)
    log.info(`Tailscale: http://100.91.112.69:${port}`)
  })

  // Audit system init
  appendAudit(CONTENT_DIR, 'system.init', 'system', {})
})
