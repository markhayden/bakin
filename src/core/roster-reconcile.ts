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
  /** Created on the target (with the models actually applied, when mapped). */
  carried: Array<{ agentId: string; model?: string; mappedFrom?: string; subagentModel?: string }>
  /** Already present on the target — left untouched. */
  existing: string[]
  /**
   * Source models with no target equivalent (agent carried without them):
   * no catalog match. Never guessed.
   */
  unmappedModels: Array<{ agentId: string; sourceModel: string; field: 'model' | 'subagentModel' }>
  /**
   * Subagent models the target runtime cannot HONOR
   * (`routingSupport().perAgentSubagentModel === false`) — stashed in the
   * carried agent's metadata (`carriedSubagentModel`) so a later switch back
   * to an honoring runtime restores them instead of dropping the assignment
   * (pi-parity OQ1: preservation without a dishonest capability flag).
   */
  preserved: Array<{ agentId: string; sourceModel: string }>
  /** Agents that could not be created on the target, and post-create carry steps that failed. */
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

/** Feature-detect per-agent subagent-model support; an unreadable declaration reads as unsupported. */
function supportsPerAgentSubagentModel(target: AgentRuntimeAdapter): boolean {
  try {
    return target.models.routingSupport().perAgentSubagentModel === true
  } catch {
    return false
  }
}

/** Adapter-private keys never carried across runtimes. */
const PRIVATE_METADATA_KEYS = new Set(['workspacePath', 'workspace', 'subagentAllowAgents'])

/**
 * Reconciler-owned metadata stash for a subagent model the hosting runtime
 * cannot honor. Written when carrying ONTO an unsupporting runtime; consumed
 * (and not re-carried) when the agent later lands on an honoring one.
 */
export const CARRIED_SUBAGENT_MODEL_KEY = 'carriedSubagentModel'

function carriedMetadata(agent: RuntimeAgent): Record<string, unknown> | undefined {
  if (!agent.metadata) return undefined
  const entries = Object.entries(agent.metadata).filter(
    ([key, value]) =>
      !PRIVATE_METADATA_KEYS.has(key)
      && key !== CARRIED_SUBAGENT_MODEL_KEY // reconciler-owned; re-stashed explicitly when still needed
      && value !== undefined && value !== null && value !== '',
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** The effective source subagent model: the live field, else a prior stash. */
function sourceSubagentModel(agent: RuntimeAgent): string | undefined {
  if (agent.subagentModel) return agent.subagentModel
  const stashed = agent.metadata?.[CARRIED_SUBAGENT_MODEL_KEY]
  return typeof stashed === 'string' && stashed.length > 0 ? stashed : undefined
}

export interface ReconcileRosterOptions {
  /** Classify (existing / would-carry / unmapped) without creating or updating anything. */
  dryRun?: boolean
}

export async function reconcileRoster(
  sourceAgents: RuntimeAgent[],
  target: AgentRuntimeAdapter,
  opts: ReconcileRosterOptions = {},
): Promise<RosterCarryReport> {
  const report: RosterCarryReport = { carried: [], existing: [], unmappedModels: [], preserved: [], failed: [] }

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
        report.unmappedModels.push({ agentId: agent.id, sourceModel: agent.model, field: 'model' })
      }
    }

    // Subagent model: same mapping rule, applied post-create via update()
    // (CreateRuntimeAgentInput doesn't accept it) — but only runtimes with
    // per-agent subagent-model support HONOR it. On an unsupporting target
    // the value is PRESERVED in metadata (never dropped): the round trip
    // OpenClaw→Pi→OpenClaw restores the assignment. A prior stash counts as
    // the source value on the way back.
    let subagentModel: string | undefined
    let stashSubagentModel: string | undefined
    const sourceSubagent = sourceSubagentModel(agent)
    if (sourceSubagent) {
      if (supportsPerAgentSubagentModel(target)) {
        const mapped = mapModelToCatalog(sourceSubagent, targetCatalog)
        if (mapped) subagentModel = mapped
        else report.unmappedModels.push({ agentId: agent.id, sourceModel: sourceSubagent, field: 'subagentModel' })
      } else {
        stashSubagentModel = sourceSubagent
        report.preserved.push({ agentId: agent.id, sourceModel: sourceSubagent })
      }
    }

    if (!opts.dryRun) {
      try {
        const metadata = {
          ...(carriedMetadata(agent) ?? {}),
          ...(stashSubagentModel ? { [CARRIED_SUBAGENT_MODEL_KEY]: stashSubagentModel } : {}),
        }
        await target.agents.create({
          id: agent.id,
          name: agent.name || agent.id,
          ...(agent.role ? { role: agent.role } : {}),
          ...(model ? { model } : {}),
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        })
      } catch (err) {
        report.failed.push({ agentId: agent.id, error: err instanceof Error ? err.message : String(err) })
        continue
      }

      if (subagentModel) {
        try {
          await target.agents.update(agent.id, { subagentModel })
        } catch (err) {
          // The agent itself carried — only the subagent-model application
          // failed. Both facts are reported.
          subagentModel = undefined
          report.failed.push({
            agentId: agent.id,
            error: `subagentModel update: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      }
    }

    report.carried.push({
      agentId: agent.id,
      ...(model ? { model } : {}),
      ...(mappedFrom ? { mappedFrom } : {}),
      ...(subagentModel ? { subagentModel } : {}),
    })
  }

  log.info(opts.dryRun ? 'Roster reconcile previewed against target runtime (dry run)' : 'Roster reconciled onto target runtime', {
    carried: report.carried.length,
    existing: report.existing.length,
    unmapped: report.unmappedModels.length,
    preserved: report.preserved.length,
    failed: report.failed.length,
  })
  return report
}
