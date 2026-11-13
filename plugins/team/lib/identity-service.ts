/**
 * Changing who an agent is: its name, emoji, role, vibe and persona files.
 * ONE service behind the Team page's `PUT /:agentId/identity` route and the
 * `team.updateIdentity` hook other plugins call (Home's introduction), so
 * both leave the same audit record and both drop the settings cache.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { resetSettingsCache } from '../../../src/core/settings'
import { updateRuntimeAgentIdentity, type IdentityFields } from './runtime-agents'

export type AgentIdentityUpdate = IdentityFields & { soul?: string; tools?: string }

export interface IdentityServiceDeps {
  runtime: AgentRuntimeAdapter
  audit: (event: string, actor: string, data: Record<string, unknown>) => void
}

const TEXT_FIELDS = ['name', 'emoji', 'role', 'vibe', 'primaryFunction', 'defaultMode', 'soul', 'tools'] as const

/** Keeps only the known fields that are non-empty strings; anything else is ignored, never written. */
export function identityUpdateFrom(input: Record<string, unknown>): AgentIdentityUpdate {
  const update: AgentIdentityUpdate = {}
  for (const field of TEXT_FIELDS) {
    const value = input[field]
    if (typeof value === 'string' && value.length > 0) update[field] = value
  }
  return update
}

/** Applies the update and returns the fields that changed. Throws `RuntimeError { kind: 'not_found' }` for an unknown agent. */
export async function applyAgentIdentity(deps: IdentityServiceDeps, agentId: string, update: AgentIdentityUpdate): Promise<string[]> {
  const updated = await updateRuntimeAgentIdentity(deps.runtime, agentId, update)
  deps.audit('agent.identity_updated', 'system', { agent: agentId, updated })
  resetSettingsCache()
  return updated
}
