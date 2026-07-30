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
import { pluginRegistry, registerCorePlugins } from './src/core/plugin-registry'
import { CORE_PLUGIN_IMPORTS } from './src/lib/plugin-static-imports'
import config from './bakin.config'

// Give the registry the static core-plugin table. Done here, not in
// plugin-registry.ts, so the plugins only live in server.ts's module
// graph — tests that import the registry don't drag every plugin +
// every plugin-level side effect (watchers, runtime path access) into
// their module load.
registerCorePlugins(CORE_PLUGIN_IMPORTS)

import { createLogger } from './src/core/logger'
import { getContentDir, getBakinPaths } from './src/core/content-dir'
import { broadcast } from './src/core/sse'
import { appendAudit } from './src/core/audit'
import { createAppServices } from './src/core/app-services'
import { bootDeliveryBridge } from './src/core/delivery'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import * as watcher from './src/core/watcher'
import { runStartupRecovery } from './src/core/server/startup-recovery'
import { createRequestHandler } from './src/core/server/request-handler'
import { getBootId } from './src/core/boot-id'
import { acquireServerLock, formatBindFailureHelp } from './src/core/server-lock'
import { STATIC_ENV_SECRET_MAPPINGS, collectPackSecretMappings, ensureBakinBinOnPath, injectIntegrationEnv, injectPackModelEnv } from './src/core/secret-env'
import { registerShutdownHandlers, triggerShutdown } from './src/core/lifecycle'
import { generateDocs } from './src/core/api-docs'
import type { buildOpenApiDocument } from './packages/host/src/api/docs-runtime'
import { collectOpenApiSources as collectTypedOpenApiSources } from './packages/host/src/api/openapi-sources'
import { startSearchEngine } from './src/core/search-startup'
import { buildAllUserPlugins } from './packages/host/src/plugin-host/user-plugin-builder'
import { dispatchCli } from './src/core/cli'
import { setEmbeddedAssets } from './packages/host/src/api/_embedded-assets'
// Generated module — pulls in every core asset via `with { type: 'file' }`
// so `bun build --compile` embeds their bytes. Only imported from server.ts
// so tests don't drag these imports through vite's transform pipeline.
import { EMBEDDED_ASSETS_STATIC } from './packages/host/src/api/_embedded-assets-static'

setEmbeddedAssets(EMBEDDED_ASSETS_STATIC)

const log = createLogger('server')

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

// Singleton lock BEFORE any side effect (dirs, plugins, watcher, antfly,
// dispatch). Two server processes against one content dir each ran their
// own dispatch loop — half-dead overlapping generations doubled work (#459).
{
  const lock = acquireServerLock(port, getBootId())
  if (!lock.acquired) {
    log.error(
      `Another Bakin server is already running (pid ${lock.holder.pid}, port ${lock.holder.port}). `
      + `Refusing to start a second instance. Stop it with: bakin stop — or if it is wedged: kill ${lock.holder.pid}`,
    )
    process.exit(1)
  }
}

// Integration env + PATH injection BEFORE services/dispatch: Pi agent shells
// inherit this process's env, so stored integration secrets (unset-only,
// env-first) and Bakin's bin dir must be in place before any turn can run.
injectIntegrationEnv([...STATIC_ENV_SECRET_MAPPINGS, ...collectPackSecretMappings()])
injectPackModelEnv()
ensureBakinBinOnPath()

/**
 * Build the source list the OpenAPI runtime builder consumes from the
 * live route registry. Plugin routes come from pluginRegistry; core routes
 * come from the typed core route declarations so body/query/response schemas
 * are preserved in live `/api/openapi`.
 */
function collectOpenApiSources(): Parameters<typeof buildOpenApiDocument>[0] {
  return collectTypedOpenApiSources(pluginRegistry.getAllPluginRoutes())
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

  // Provision the runtime's tool-access wiring (OpenClaw writes per-agent MCP
  // server entries; Pi is a no-op). This is a config WRITE, so it lives here
  // at server boot — never inside createAppServices, which read-only CLI
  // paths also call. Never block boot on a provisioning failure.
  try {
    await appServices.runtime.provisionToolAccess()
  } catch (err) {
    log.warn('Runtime tool-access provisioning failed at boot', err)
  }

  // Discord delivery bridge (#669): connects only when configured AND the
  // active runtime lacks native delivery (D11). Server-boot only — never
  // inside createAppServices. Never block boot on a transport failure; the
  // delivery.discord doctor check surfaces a down bridge.
  try {
    await bootDeliveryBridge(appServices.runtime)
  } catch (err) {
    log.warn('Discord delivery bridge boot failed', err)
  }
  // The Bakin runtime skill previously only installed via the openclaw-gated
  // onboarding component, so fresh installs on other runtimes (Pi implements
  // skills too) never received it. Idempotent; render is deterministic per
  // (template, tool-access style).
  try {
    const { syncBakinRuntimeSkill } = await import('./src/core/bakin-skill')
    const skillResult = await syncBakinRuntimeSkill(process.cwd(), appServices.runtime)
    if (skillResult !== 'noop') log.info('Bakin runtime skill synced at boot', { result: skillResult })
  } catch (err) {
    log.warn('Bakin runtime skill sync failed at boot', err)
  }

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
  // Start the durable-outbox pump (D5/F2): every ctx.search write journals
  // to SQLite then drains through here, resolved logical→physical through
  // the blue/green registry (dual-write during migrations). Resumes
  // whatever the journal holds from prior boots — this line is the whole
  // "recovery" story for writes. Global drop-and-reindex migration is gone:
  // schema changes are per-table blue/green migrations (D4).
  const { startOutboxPump } = await import('./src/core/search-outbox')
  const { getSearchAdapter } = await import('./src/core/search-registry')
  const { resolveDrainTargets } = await import('@bakin/core/search/tables')
  startOutboxPump({ adapter: getSearchAdapter(), resolveTargets: resolveDrainTargets })

  await startSearchEngine()


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
        .then((agentId) => appServices.runtime.messaging.send({ agentId, content: message, activityClass: 'system' }))
        .catch(err => {
          log.error('Failed to notify main agent of completion', err)
        })
    },
  })

  const server = createServer(createRequestHandler({ port, CONTENT_DIR, collectOpenApiSources }))

  // Start file watching before the server loops. Dispatch/watchdog wait until
  // restart recovery has taken the first look at stale in-progress tasks.
  watcher.start({ contentDir: CONTENT_DIR, eventBus, onInboxFile: handleInboxFile })

  // Notify all plugins that every plugin is now active
  await pluginRegistry.onAllReady()

  // Register graceful shutdown
  registerShutdownHandlers(server, CONTENT_DIR)

  // A bind failure (another generation or process squatting the port) used
  // to throw uncaught AFTER the watcher/antfly side effects started,
  // orphaning children (#459). Route it through the graceful-shutdown chain
  // and exit non-zero.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`Cannot bind port ${port} — ${formatBindFailureHelp(port)}`, err)
      triggerShutdown('EADDRINUSE', 1)
      return
    }
    log.error('HTTP server error', err)
  })

  // Without this, an EADDRINUSE 'error' event throws as an uncaught
  // exception — by now antfly is already spawned and the watcher is running,
  // and the crash bypasses the lifecycle shutdown, orphaning the child
  // (#459). Fail loudly with remediation and take the graceful path instead.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(
        `Port ${port} is already in use - another Bakin (or a half-dead dev generation) is holding it. ` +
        `Find it with: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
        err,
      )
    } else {
      log.error('HTTP server error', err)
    }
    // Route through the lifecycle shutdown (registered above) so children
    // and watchers come down cleanly; exitCode survives into its exit call.
    process.exitCode = 1
    process.kill(process.pid, 'SIGTERM')
  })

  server.listen(port, '0.0.0.0', () => {
    log.info(`Bakin ready on http://localhost:${port}`)
    log.info(`Listening on 0.0.0.0:${port} (Tailscale: http://100.91.112.69:${port})`)
    if (process.env.BAKIN_DEV === '1') {
      const logPath = join(getBakinPaths().logs, 'server.log')
      log.info(`Full logs: ${logPath}`, { path: logPath })
    }

    void runStartupRecovery(CONTENT_DIR, port)
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
