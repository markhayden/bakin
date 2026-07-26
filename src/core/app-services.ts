import type { AppServices } from '@bakin/core/app-services'
import type { AdapterTurnActivityEvent } from '@bakin/core/adapters/shared'
import {
  migrateAntflyPasswordToSecretStore,
  resolveAntflyPassword,
} from '@bakin/core/media'
import { appendAudit } from './audit'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'
import { createRuntimeExecToolProvider } from './exec-tools/provider'
import { createRuntimeAdapter, createRuntimeAdapterHealthChecks } from './runtime-adapter-factory'
import { getDeliveryBridge } from './delivery'
import { createSearchAdapter } from './search-adapter-factory'
import { createRuntimeToolUsageRecorder } from './runtime-tool-usage'
import { createRuntimeTurnUsageRecorder } from './runtime-turn-usage'
import { getSettings, resetSettingsCache } from './settings'
import { registerAdapterHealthCheck, unregisterOwnerHealth } from './health-check-registry'
// Accessors live in a leaf module (breaks the composition-root import cycle);
// re-exported below so existing `from './app-services'` imports are unchanged.
import { getAppServices, maybeGetAppServices, setAppServices } from './app-services-store'

const log = createLogger('app-services')

/**
 * settings.json carries only the basic-auth username; the password resolves
 * from env/secret store here, at the one place the adapter is initialized —
 * the secret never enters the settings cache or GET /api/settings.
 */
function withAntflyAuthSecret(searchSettings: Record<string, unknown>): Record<string, unknown> {
  const auth = searchSettings.auth as { username?: string } | undefined
  if (!auth?.username) return searchSettings
  const resolved = resolveAntflyPassword()
  if (!resolved) {
    log.warn('Antfly auth username configured but no password found (set ANTFLY_PASSWORD or the antfly secret-store entry) — connecting without auth')
    return { ...searchSettings, auth: undefined }
  }
  return { ...searchSettings, auth: { username: auth.username, password: resolved.password } }
}

/**
 * Base URL for Bakin's MCP server, as written into runtime-side MCP config by
 * `provisionToolAccess`. `BAKIN_MCP_BASE_URL` overrides for setups where
 * "localhost from the runtime's perspective" is wrong (the dockerized OpenClaw
 * rig needs `http://host.docker.internal:<port>`).
 */
export function resolveBakinMcpBaseUrl(): string {
  return process.env.BAKIN_MCP_BASE_URL || `http://localhost:${Number(process.env.PORT || 3737)}`
}

export async function createAppServices(): Promise<AppServices> {
  // Relocate a legacy settings.json password before the settings cache forms.
  if (migrateAntflyPasswordToSecretStore()) {
    log.info('Migrated antfly auth password from settings.json into the secret store')
    resetSettingsCache()
  }
  const settings = getSettings()
  const contentDir = getContentDir()
  const { getSharedBakinTaskStore } = await import('./task-store')

  const runtime = createRuntimeAdapter(settings.runtime.adapter)
  const search = createSearchAdapter(settings.search.adapter)
  const tasks = getSharedBakinTaskStore()

  const adapterInit = {
    contentDir,
    logger: log,
    audit: (event: { adapter: string; action: string; subject?: string; data?: Record<string, unknown> }) => {
      appendAudit(contentDir, `adapter.${event.adapter}.${event.action}`, 'system', {
        ...(event.subject ? { subject: event.subject } : {}),
        ...(event.data ?? {}),
      }, 'system')
    },
  }

  // In-process tool delivery for runtimes that register Bakin exec tools
  // directly in agent sessions (Pi). Out-of-band runtimes (OpenClaw) reach the
  // same registry over MCP and use the base URL to write their config entries.
  //
  // NOTE: initialize() only THREADS the base URL — it never writes config.
  // Provisioning (a config WRITE) happens only at explicit call sites: server
  // boot (server.ts), onboarding install(), and adapter roster changes. A
  // read-only CLI path (`bakin check …`) creating app services must never
  // mutate the runtime config — and deriving the URL from each process's env
  // would let a PORT-less shell rewrite working :4000 entries back to :3737.
  const execTools = createRuntimeExecToolProvider()
  const onToolActivity = createRuntimeToolUsageRecorder()
  const recordTurnActivity = createRuntimeTurnUsageRecorder()
  const onTurnActivity = (event: AdapterTurnActivityEvent): void => {
    try {
      onToolActivity.reconcileTurn(event)
    } finally {
      recordTurnActivity(event)
    }
  }

  await runtime.initialize({
    ...adapterInit,
    settings: settings.runtime.settings,
    // Live view: extension trust changes (and other per-turn knobs) apply on
    // the next turn without a server restart.
    getLiveSettings: () => getSettings().runtime.settings,
    execTools,
    onToolActivity,
    onTurnActivity,
    bakinMcpBaseUrl: resolveBakinMcpBaseUrl(),
    // Handle only (#669): runtimes without native delivery expose
    // runtime.channels by delegating to this when configured. Boot/shutdown
    // stay server-owned (server.ts / lifecycle.ts) — createAppServices is
    // also called by read-only CLI paths and must never connect transports.
    channelBridge: getDeliveryBridge(),
  })
  await search.initialize({ ...adapterInit, settings: withAntflyAuthSecret(settings.search.settings) })

  // Adapter diagnostics join the same owner-aware registry as plugin/core
  // checks. Recomposition replaces the active runtime's registrations so a
  // restart or adapter switch cannot retain stale definitions.
  const previousRuntimeName = maybeGetAppServices()?.runtime.name
  for (const adapterId of new Set([previousRuntimeName, runtime.name])) {
    if (adapterId) unregisterOwnerHealth('adapter', adapterId)
  }
  const runtimeLabel = runtime.name === 'pi' ? 'Pi' : runtime.name
  for (const check of createRuntimeAdapterHealthChecks(
    settings.runtime.adapter,
    () => getSettings().runtime.settings,
  )) {
    registerAdapterHealthCheck(runtime.name, runtimeLabel, check)
  }

  const services: AppServices = {
    runtime,
    search,
    tasks,
  }
  setAppServices(services)
  log.info('App services initialized', {
    runtime: `${runtime.name}@${runtime.version}`,
    search: `${search.name}@${search.version}`,
  })
  return services
}

// Re-exported from the leaf store so `import { getAppServices } from
// './app-services'` keeps working across the codebase.
export { getAppServices, maybeGetAppServices, setAppServices }
