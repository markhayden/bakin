import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'
import { createPiRuntimeAdapter } from '@bakin/adapter-pi'
import type { RuntimeAdapterName } from './settings'

export interface RuntimeAdapterSupportInfo {
  setupUrl: string
  docsUrl: string
}

const RUNTIME_ADAPTER_SUPPORT: Record<RuntimeAdapterName, RuntimeAdapterSupportInfo> = {
  openclaw: {
    setupUrl: 'https://makinbakin.com/docs/start/first-time-setup/',
    docsUrl: 'https://openclaw.ai/docs/',
  },
  pi: {
    setupUrl: 'https://pi.dev/docs/latest/quickstart',
    docsUrl: 'https://pi.dev/docs/latest',
  },
}

export function createRuntimeAdapter(name: RuntimeAdapterName): AgentRuntimeAdapter {
  switch (name) {
    case 'openclaw':
      return createOpenClawRuntimeAdapter()
    case 'pi':
      return createPiRuntimeAdapter()
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
