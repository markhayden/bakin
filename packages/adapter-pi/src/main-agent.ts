/**
 * The 'main' orchestrator invariant. Bakin's neutral main-agent resolution
 * (selectRuntimeMainAgent) prefers id 'main' → role 'orchestrator' → first;
 * onboarding integrity hard-requires a resolvable main agent with a
 * workspace. First initialize() seeds it when the registry is empty.
 */
import type { AdapterLogger } from '@bakin/core/adapters/runtime'
import { getAgentWorkspaceDir } from './home'
import { mutateRegistry, scaffoldAgentDirs, type PiAgentRecord } from './registry'

export const MAIN_AGENT_ID = 'main'

export async function seedMainAgentIfEmpty(logger?: AdapterLogger): Promise<PiAgentRecord | null> {
  return mutateRegistry((registry) => {
    if (registry.agents.length > 0) return null
    const now = new Date().toISOString()
    const main: PiAgentRecord = {
      id: MAIN_AGENT_ID,
      name: 'Main',
      role: 'orchestrator',
      createdAt: now,
      updatedAt: now,
      metadata: { workspace: getAgentWorkspaceDir(MAIN_AGENT_ID) },
    }
    registry.agents.push(main)
    scaffoldAgentDirs(MAIN_AGENT_ID)
    logger?.info('adapter-pi: seeded main orchestrator agent')
    return main
  })
}
