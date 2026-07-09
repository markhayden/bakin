/**
 * The globalThis-backed AppServices accessor — a LEAF module (type-only
 * import of AppServices, nothing else). Split out of app-services.ts so
 * modules that only READ the active services (dispatch-prompts resolving
 * the runtime's tool-access style, the exec-tool registry, dispatch, search)
 * don't statically import the composition root — which pulls in the whole
 * exec-tool/dispatch graph and closes an import cycle back to app-services.
 * app-services.ts re-exports these so existing `from './app-services'`
 * imports keep working; hot paths import from here directly.
 */
import type { AppServices } from '@bakin/core/app-services'

type AppServicesGlobal = typeof globalThis & {
  __bakinAppServices?: AppServices
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
