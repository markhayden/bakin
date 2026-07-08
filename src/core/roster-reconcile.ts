/**
 * Roster reconciliation — the best-effort cross-runtime carry-over seam
 * (P3.1). Bakin-owned state (tasks, assets, schedules, workflows, chat,
 * audit) carries across a runtime switch automatically because the switch
 * never touches ~/.bakin. The agent ROSTER is the one runtime-owned thing
 * needing migration: this module carries missing agents from a source-roster
 * snapshot onto the target runtime and reports honestly what could not map.
 *
 * Semantics:
 *  - Agents already on the target are UNTOUCHED (round-trip preservation:
 *    each runtime keeps its own roster + assignments while inactive).
 *  - Missing agents are created with identity metadata; their model carries
 *    only when it maps onto the target catalog (exact id, else a UNIQUE
 *    bare-model match across providers) — an unmapped model is REPORTED and
 *    the agent falls back to the target's routing default. Never guessed.
 *  - Full carry-over polish (.userEdited, deep workspace content, edge
 *    mappings) = follow-up tickets that slot INTO this seam (#625+).
 */
import type { AgentRuntimeAdapter, RuntimeAgent } from '@bakin/core/adapters/runtime'
import { createLogger } from './logger'

const log = createLogger('roster-reconcile')

export interface RosterCarryReport {
  /** Created on the target (with the model actually applied, when mapped). */
  carried: Array<{ agentId: string; model?: string; mappedFrom?: string }>
  /** Already present on the target — left untouched. */
  existing: string[]
  /** Source models with no target-catalog equivalent (agent carried modelless). */
  unmappedModels: Array<{ agentId: string; sourceModel: string }>
  /** Agents that could not be created on the target. */
  failed: Array<{ agentId: string; error: string }>
}

/**
 * Map a source model id onto the target catalog:
 *   1. exact id match → as-is
 *   2. UNIQUE bare-model match (`anything/<model>` present exactly once) →
 *      the target's qualified id (catalogs differ per runtime:
 *      `openai/gpt-5.5` ↔ `openai-codex/gpt-5.5`)
 *   3. otherwise null — reported, never guessed.
 */
export function mapModelToCatalog(sourceModel: string, targetCatalog: string[]): string | null {
  if (targetCatalog.includes(sourceModel)) return sourceModel
  const bare = sourceModel.includes('/') ? sourceModel.slice(sourceModel.indexOf('/') + 1) : sourceModel
  const matches = targetCatalog.filter((id) => id === bare || id.endsWith(`/${bare}`))
  return matches.length === 1 ? matches[0] : null
}

/** Adapter-private keys never carried across runtimes. */
const PRIVATE_METADATA_KEYS = new Set(['workspacePath', 'workspace', 'subagentAllowAgents'])

function carriedMetadata(agent: RuntimeAgent): Record<string, unknown> | undefined {
  if (!agent.metadata) return undefined
  const entries = Object.entries(agent.metadata).filter(
    ([key, value]) => !PRIVATE_METADATA_KEYS.has(key) && value !== undefined && value !== null && value !== '',
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export async function reconcileRoster(
  sourceAgents: RuntimeAgent[],
  target: AgentRuntimeAdapter,
): Promise<RosterCarryReport> {
  const report: RosterCarryReport = { carried: [], existing: [], unmappedModels: [], failed: [] }

  const targetIds = new Set((await target.agents.list()).map((agent) => agent.id))
  let targetCatalog: string[] = []
  try {
    targetCatalog = (await target.models.listAvailable({ includeUnavailable: true })).map((m) => m.id)
  } catch (err) {
    // No catalog → every model is unmappable; agents still carry (modelless).
    log.warn('Target model catalog unavailable during roster reconcile — carrying agents without models', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  for (const agent of sourceAgents) {
    if (!agent.id) continue
    if (targetIds.has(agent.id)) {
      report.existing.push(agent.id)
      continue
    }

    let model: string | undefined
    let mappedFrom: string | undefined
    if (agent.model) {
      const mapped = mapModelToCatalog(agent.model, targetCatalog)
      if (mapped) {
        model = mapped
        if (mapped !== agent.model) mappedFrom = agent.model
      } else {
        report.unmappedModels.push({ agentId: agent.id, sourceModel: agent.model })
      }
    }

    try {
      await target.agents.create({
        id: agent.id,
        name: agent.name || agent.id,
        ...(agent.role ? { role: agent.role } : {}),
        ...(model ? { model } : {}),
        ...(carriedMetadata(agent) ? { metadata: carriedMetadata(agent) } : {}),
      })
      report.carried.push({ agentId: agent.id, ...(model ? { model } : {}), ...(mappedFrom ? { mappedFrom } : {}) })
    } catch (err) {
      report.failed.push({ agentId: agent.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  log.info('Roster reconciled onto target runtime', {
    carried: report.carried.length,
    existing: report.existing.length,
    unmapped: report.unmappedModels.length,
    failed: report.failed.length,
  })
  return report
}
