import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'
import type { RuntimeAdapterName } from './settings'

export function createRuntimeAdapter(name: RuntimeAdapterName): AgentRuntimeAdapter {
  switch (name) {
    case 'openclaw':
      return createOpenClawRuntimeAdapter()
    default:
      throw new Error(`Unknown runtime adapter: ${name}`)
  }
}
