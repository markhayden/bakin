/**
 * Required row: the runtime process's protocol floor (#1007 D7.10). Listed
 * only when the active runtime exposes `compatibility()`; answered from
 * the adapter's cached handshake evidence — never a live probe here.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { fingerprintOf } from '../inventory'
import type { UpdateObservation, UpdateSource } from '../types'

export interface GatewaySourceDeps {
  runtime: () => Pick<AgentRuntimeAdapter, 'name' | 'compatibility'>
}

export function observeGateway(runtimeName: string, verdict: NonNullable<ReturnType<NonNullable<AgentRuntimeAdapter['compatibility']>>>): UpdateObservation {
  const installed = verdict.observed !== undefined ? { version: verdict.observed, display: `protocol ${verdict.observed}` } : undefined
  const available = { version: verdict.required, display: `protocol ${verdict.required}` }
  if (verdict.state === 'ok') return { installed, outcome: 'current' }
  if (verdict.state === 'below-floor') {
    return {
      installed,
      available,
      reason: 'below-floor',
      outcome: 'update-available',
      action: { kind: 'manual', pointer: `Upgrade the ${runtimeName} runtime so its gateway speaks protocol ${verdict.required} or newer, then restart it.` },
    }
  }
  return { installed, available, outcome: 'unknown' }
}

export function createGatewaySource(deps: GatewaySourceDeps): UpdateSource {
  return {
    kind: 'gateway',
    async inventory() {
      const runtime = deps.runtime()
      if (!runtime.compatibility) return []
      const verdict = runtime.compatibility()
      return [{
        subject: { kind: 'gateway', id: runtime.name, label: `${runtime.name} gateway` },
        group: 'required',
        fingerprint: fingerprintOf({ adapter: runtime.name, required: verdict.required }),
        source: { kind: 'runtime', endpoint: runtime.name },
      }]
    },
    async observe() {
      const runtime = deps.runtime()
      if (!runtime.compatibility) throw new Error(`the ${runtime.name} runtime reports no compatibility evidence`)
      return observeGateway(runtime.name, runtime.compatibility())
    },
  }
}
