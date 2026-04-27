import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'

export interface OpenClawRuntimeAdapterOptions {
  settings?: Record<string, unknown>
}

export function createOpenClawRuntimeAdapter(
  options: OpenClawRuntimeAdapterOptions = {}
): AgentRuntimeAdapter {
  void options
  return createMockRuntimeAdapter({
    name: 'openclaw',
    version: '0.1.0',
    requiredCoreVersion: '^1.0.0',
  })
}
