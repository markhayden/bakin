/**
 * Honest degradation for surfaces Pi does not have (SPEC D3/AD6):
 *
 *   channels/cron — OMITTED from the adapter entirely (P2.1): the contract
 *              made them optional, so absence IS the signal and consumers
 *              feature-detect. No stubs to maintain here.
 *   tools.invoke — no runtime-native tool registry to address (zero
 *              production callers today; typed failure keeps it honest).
 *
 * What remains throws RuntimeError kind 'runtime_failed' with an explicit
 * "not supported by the pi runtime" message — never a silent no-op, never
 * fabricated success.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { RuntimeError } from '@bakin/core/adapters/runtime'

function unsupported(surface: string): never {
  throw new RuntimeError(`adapter-pi: ${surface} is not supported by the pi runtime`, {
    kind: 'runtime_failed',
  })
}

export function createToolsSurface(): AgentRuntimeAdapter['tools'] {
  return {
    invoke: async () => unsupported('tools.invoke'),
  }
}
