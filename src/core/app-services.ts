import type { AppServices } from '@bakin/core/app-services'
import { createHealthService } from '@bakin/core/app-services'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'
import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'
import { createAntflySearchAdapter } from '@bakin/adapter-antfly'
import { appendAudit } from './audit'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'
import { getSettings } from './settings'

type AppServicesGlobal = typeof globalThis & {
  __bakinAppServices?: AppServices
}

const log = createLogger('app-services')

export async function createAppServices(): Promise<AppServices> {
  const settings = getSettings()
  const contentDir = getContentDir()

  const runtime = createRuntimeAdapter(settings.runtime.adapter)
  const search = createSearchAdapter(settings.search.adapter)
  const tasks = createMockBakinTaskStore()

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

  await runtime.initialize({ ...adapterInit, settings: settings.openclaw })
  await search.initialize({ ...adapterInit, settings: settings.antfly })

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

function createRuntimeAdapter(name: string) {
  switch (name) {
    case 'openclaw':
      return createOpenClawRuntimeAdapter()
    default:
      throw new Error(`Unknown runtime adapter: ${name}`)
  }
}

function createSearchAdapter(name: string) {
  switch (name) {
    case 'antfly':
      return createAntflySearchAdapter()
    default:
      throw new Error(`Unknown search adapter: ${name}`)
  }
}
