import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'
import type { RuntimeAdapterName } from './settings'

export interface RuntimeAdapterSupportInfo {
  setupUrl: string
  docsUrl: string
}

const RUNTIME_ADAPTER_SUPPORT: Record<RuntimeAdapterName, RuntimeAdapterSupportInfo> = {
  openclaw: {
    setupUrl: 'https://openclaw.ai/',
    docsUrl: 'https://openclaw.ai/docs/',
  },
}

export function createRuntimeAdapter(name: RuntimeAdapterName): AgentRuntimeAdapter {
  switch (name) {
    case 'openclaw':
      return createOpenClawRuntimeAdapter()
    default:
      throw new Error(`Unknown runtime adapter: ${name}`)
  }
}

export function getRuntimeAdapterSupport(name: RuntimeAdapterName): RuntimeAdapterSupportInfo {
  const support = RUNTIME_ADAPTER_SUPPORT[name]
  if (!support) throw new Error(`Unknown runtime adapter: ${name}`)
  return support
}

export const DEFAULT_RUNTIME_ADAPTER_SUPPORT = RUNTIME_ADAPTER_SUPPORT.openclaw
