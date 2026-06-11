/**
 * In-process registry refresh after agent-package mutations (layered-context
 * spec, C9) — sync, migration, install, and removal all change what the
 * lockfile + runtime skill store contain, and the server holds in-memory
 * views of both (workflow source registry, agent-package skill registry,
 * skill resolution cache). Re-loading them here is what makes "changes are
 * live without a server restart" true.
 *
 * Also broadcasts an SSE event so open UIs refresh their sync state.
 */
import { createLogger } from '../logger'
import { loadAgentPackageSources } from './load-sources'
import { clearSkillCache } from '../../../plugins/workflows/lib/skill-loader'
import { broadcast } from '../sse'

const log = createLogger('agent-pkg:reload')

export interface ReloadSummary {
  workflowsRegistered: number
  skillsRegistered: number
}

export async function reloadAgentPackageRegistries(
  event: { kind: 'synced' | 'migrated'; agentId?: string },
): Promise<ReloadSummary | null> {
  try {
    const result = loadAgentPackageSources()
    clearSkillCache()
    broadcast({
      type: 'agent_pkg:changed',
      kind: event.kind,
      agentId: event.agentId,
      timestamp: new Date().toISOString(),
    })
    log.info('Agent-package registries reloaded', {
      kind: event.kind,
      agentId: event.agentId,
      workflows: result.workflowsRegistered,
      skills: result.skillsRegistered,
    })
    return {
      workflowsRegistered: result.workflowsRegistered,
      skillsRegistered: result.skillsRegistered,
    }
  } catch (err) {
    // Never let a reload failure mask a successful sync — the receipt is
    // already written; surface the reload problem loudly instead.
    log.error('Post-sync registry reload failed', err as Error, { kind: event.kind })
    return null
  }
}
