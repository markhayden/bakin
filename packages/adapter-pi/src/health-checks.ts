/**
 * Adapter-contributed doctor checks: is the Pi world on this machine
 * actually usable? (Auth present, registry parseable, a model available,
 * agent dirs writable.) Read-only probes — autoFix stays false.
 */
import { accessSync, constants, existsSync, mkdirSync } from 'fs'

import type { AdapterHealthCheckDefinition, AdapterHealthCheckResult } from '@bakin/core/adapters/runtime'
import { listAuthProviders } from './config'
import { getPiAgentsRoot, getPiHome } from './home'
import { getModelRegistry } from './models'
import { readRegistry } from './registry'
import { createExtensionsSurface } from './extensions'

function result(check: string, status: AdapterHealthCheckResult['status'], message: string): AdapterHealthCheckResult {
  return { check, status, message, autoFixable: false }
}

export function createHealthChecks(
  getSettings?: () => Record<string, unknown> | undefined,
): AdapterHealthCheckDefinition[] {
  return [
    {
      id: 'pi.extensions',
      name: 'Pi extension trust',
      run: async () => {
        const surface = createExtensionsSurface(() => getSettings?.())
        const list = await surface.list()
        const pending = list.filter((e) => e.status === 'pending')
        if (pending.length === 0) {
          return [result('pi.extensions', 'ok', list.length === 0
            ? 'No extensions installed'
            : `${list.length} extension(s), none awaiting approval`)]
        }
        return [result(
          'pi.extensions',
          'warn',
          `${pending.length} extension(s) discovered but NOT loading (awaiting approval): ${pending.map((e) => e.id).join(', ')} — approve on the Runtime page (Runtimes tab) or \`bakin runtime extensions allow <id>\``,
        )]
      },
    },
    {
      id: 'pi.home',
      name: 'Pi home + agent registry',
      run: async () => {
        const out: AdapterHealthCheckResult[] = []
        if (!existsSync(getPiHome())) {
          out.push(result('pi.home', 'error', `Pi home not found at ${getPiHome()} — install pi and run it once`))
          return out
        }
        try {
          const registry = readRegistry()
          out.push(result('pi.home', 'ok', `Pi home present; ${registry.agents.length} Bakin agent(s) registered`))
        } catch (err) {
          out.push(result('pi.home', 'error', err instanceof Error ? err.message : String(err)))
          return out
        }
        try {
          mkdirSync(getPiAgentsRoot(), { recursive: true })
          accessSync(getPiAgentsRoot(), constants.W_OK)
          out.push(result('pi.agents-root', 'ok', 'Agent workspace root is writable'))
        } catch {
          out.push(result('pi.agents-root', 'error', `Agent root not writable: ${getPiAgentsRoot()}`))
        }
        return out
      },
    },
    {
      id: 'pi.auth',
      name: 'Pi provider auth + models',
      run: async () => {
        const out: AdapterHealthCheckResult[] = []
        const providers = listAuthProviders()
        if (providers.length === 0) {
          out.push(result('pi.auth', 'error', 'No providers in Pi auth.json — run `pi` and log in'))
        } else {
          out.push(result('pi.auth', 'ok', `Auth configured for: ${providers.join(', ')}`))
        }
        try {
          const { registry } = getModelRegistry()
          registry.refresh()
          const available = registry.getAvailable()
          out.push(available.length > 0
            ? result('pi.models', 'ok', `${available.length} model(s) available`)
            : result('pi.models', 'error', 'No Pi models have configured auth'))
        } catch (err) {
          out.push(result('pi.models', 'error', `Model registry failed: ${err instanceof Error ? err.message : String(err)}`))
        }
        return out
      },
    },
  ]
}
