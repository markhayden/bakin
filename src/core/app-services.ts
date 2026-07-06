import type { AppServices } from '@bakin/core/app-services'
import { createHealthService } from '@bakin/core/app-services'
import {
  migrateAntflyPasswordToSecretStore,
  resolveAntflyPassword,
} from '@bakin/core/media'
import { appendAudit } from './audit'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'
import { createRuntimeExecToolProvider } from './exec-tools/provider'
import { createRuntimeAdapter } from './runtime-adapter-factory'
import { createSearchAdapter } from './search-adapter-factory'
import { getSettings, resetSettingsCache } from './settings'

type AppServicesGlobal = typeof globalThis & {
  __bakinAppServices?: AppServices
}

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

  await runtime.initialize({
    ...adapterInit,
    settings: settings.runtime.settings,
    // In-process tool delivery for runtimes that register Bakin exec tools
    // directly in agent sessions (Pi). OpenClaw ignores this (MCP/mcporter).
    execTools: createRuntimeExecToolProvider(),
  })
  await search.initialize({ ...adapterInit, settings: withAntflyAuthSecret(settings.search.settings) })

  const services: AppServices = {
    runtime,
    search,
    tasks,
    health: createHealthService([runtime, search]),
  }
  setAppServices(services)
  log.info('App services initialized', {
    runtime: `${runtime.name}@${runtime.version}`,
    search: `${search.name}@${search.version}`,
  })
  return services
}

export function setAppServices(services: AppServices): void {
  ;(globalThis as AppServicesGlobal).__bakinAppServices = services
}

export function getAppServices(): AppServices {
  const services = maybeGetAppServices()
  if (!services) {
    throw new Error('Bakin AppServices have not been initialized')
  }
  return services
}

export function maybeGetAppServices(): AppServices | undefined {
  return (globalThis as AppServicesGlobal).__bakinAppServices
}
