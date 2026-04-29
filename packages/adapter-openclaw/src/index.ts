import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { OpenClawRuntimeAdapter } from './runtime'

export interface OpenClawRuntimeAdapterOptions {
  settings?: Record<string, unknown>
}

export function createOpenClawRuntimeAdapter(
  options: OpenClawRuntimeAdapterOptions = {}
): AgentRuntimeAdapter {
  return new OpenClawRuntimeAdapter(options)
}
