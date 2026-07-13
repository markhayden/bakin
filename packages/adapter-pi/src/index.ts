/**
 * @bakin/adapter-pi — AgentRuntimeAdapter for the Pi coding-agent runtime
 * (https://pi.dev), driven in-process via @earendil-works/pi-coding-agent.
 *
 * Everything Pi-specific (paths, SDK imports, session formats) lives inside
 * this package. Upstream code consumes only the adapter contract; the sole
 * sanctioned import site outside this package is the runtime adapter
 * factory (src/core/runtime-adapter-factory.ts) — architecture-test enforced.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

import { PiRuntimeAdapter, type PiRuntimeAdapterOptions } from './runtime'

export { createPiHealthChecks } from './health-checks'

export function createPiRuntimeAdapter(options: PiRuntimeAdapterOptions = {}): AgentRuntimeAdapter {
  return new PiRuntimeAdapter(options)
}
