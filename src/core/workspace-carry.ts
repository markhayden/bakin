/**
 * Workspace content carry — the runtime-switch step that keeps an agent's
 * SELF across runtimes (runtime-switch-carry spec, D2). The roster carry
 * creates the agent; this module carries what makes it that agent: canonical
 * workspace files (SOUL/IDENTITY/AGENTS/TOOLS — including everything the
 * agent wrote outside managed blocks), memory notes, and agent-authored
 * skills.
 *
 * Kind-aware by design:
 *  - Workspace files copy VERBATIM via the workspace-file surface, EXCLUDING
 *    the source adapter's skill-storage subtree (derived from
 *    workspaceFileStats 'skill' entries — OpenClaw keeps skills in
 *    `skills/<name>/`, Pi under `.pi/skills/`; a verbatim path copy would
 *    land them where the target never reads). No stats surface → no known
 *    skill subtree → every listed file carries.
 *  - Skills carry through the adapter-neutral `runtime.skills` surface so
 *    they land at the TARGET's real skill location. Package-managed skills
 *    (an `installedBy` marker) are skipped — `agents sync` re-projects them
 *    adapter-appropriately and collision-safely.
 *
 * Failure semantics (D9/D10): a dead or partially-readable source degrades
 * to a partial snapshot with per-agent error notes; write failures land in
 * `failed[]`. Nothing here ever fails a switch that already flipped.
 */
import type { AgentRuntimeAdapter, RuntimeAgent, RuntimeSkill, WorkspaceFile } from '@bakin/core/adapters/runtime'
import { createLogger } from './logger'

const log = createLogger('workspace-carry')

export interface AgentContent {
  files: WorkspaceFile[]
  skills: RuntimeSkill[]
  skippedPackageManaged: number
  /** Snapshot-side read failures (partial snapshot honesty). */
  errors: string[]
}

export interface AgentContentSnapshot {
  agents: Map<string, AgentContent>
}

export interface WorkspaceCarryReport {
  /** Content written for agents the roster carry created on the target. */
  carried: Array<{ agentId: string; files: number; bytes: number }>
  /** Skill carry per agent (only listed when there was something to decide). */
  skills: Array<{ agentId: string; carried: number; skippedPackageManaged: number }>
  /** Agents already on the target — their workspaces are never touched. */
  skippedExisting: string[]
  /** Per-file/skill write failures and snapshot-side read failures. */
  failed: Array<{ agentId: string; path: string; error: string }>
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The source adapter's skill-storage prefixes, derived from the neutral
 * stats classification: the directory of every 'skill'-classified entry.
 */
async function skillPathPrefixes(source: AgentRuntimeAdapter, agentId: string): Promise<string[]> {
  try {
    const stats = await source.agents.workspaceFileStats?.(agentId)
    if (!stats) return []
    const prefixes = new Set<string>()
    for (const stat of stats) {
      if (stat.kind !== 'skill') continue
      const cut = stat.name.lastIndexOf('/')
      if (cut > 0) prefixes.add(stat.name.slice(0, cut + 1))
    }
    return [...prefixes]
  } catch {
    return []
  }
}

/**
 * Capture every source agent's carryable content IN MEMORY — the switch
 * calls this before the source runtime is torn down. Read failures degrade
 * to per-agent error notes; this never throws.
 */
export async function snapshotAgentContent(
  source: AgentRuntimeAdapter,
  agents: RuntimeAgent[],
): Promise<AgentContentSnapshot> {
  const snapshot: AgentContentSnapshot = { agents: new Map() }
  for (const agent of agents) {
    if (!agent.id) continue
    const content: AgentContent = { files: [], skills: [], skippedPackageManaged: 0, errors: [] }
    snapshot.agents.set(agent.id, content)

    try {
      const excluded = await skillPathPrefixes(source, agent.id)
      for (const path of await source.agents.listWorkspaceFiles(agent.id)) {
        if (excluded.some((prefix) => path.startsWith(prefix))) continue
        const file = await source.agents.readWorkspaceFile(agent.id, path)
        if (file) content.files.push(file)
      }
    } catch (err) {
      content.errors.push(`workspace files: ${errMsg(err)}`)
    }

    try {
      for (const entry of await source.skills.list(agent.id)) {
        // list() may be shallow (OpenClaw) — get() returns files + markers.
        const skill = (await source.skills.get(entry.name, agent.id)) ?? entry
        if (skill.metadata?.installedBy) {
          content.skippedPackageManaged += 1
          continue
        }
        content.skills.push(skill)
      }
    } catch (err) {
      content.errors.push(`skills: ${errMsg(err)}`)
    }
  }
  return snapshot
}

/**
 * Write the snapshot onto the target for agents the roster carry CREATED
 * (`carriedIds`). `existingIds` agents are reported skipped when the source
 * had content for them — their target workspaces are already someone's
 * territory. Write failures degrade to `failed[]`; this never throws.
 */
export async function carryAgentContent(
  snapshot: AgentContentSnapshot,
  target: AgentRuntimeAdapter,
  carriedIds: string[],
  existingIds: string[],
): Promise<WorkspaceCarryReport> {
  const report: WorkspaceCarryReport = { carried: [], skills: [], skippedExisting: [], failed: [] }

  for (const agentId of existingIds) {
    const content = snapshot.agents.get(agentId)
    if (content && (content.files.length > 0 || content.skills.length > 0)) {
      report.skippedExisting.push(agentId)
    }
  }

  for (const agentId of carriedIds) {
    const content = snapshot.agents.get(agentId)
    if (!content) continue

    let files = 0
    let bytes = 0
    for (const file of content.files) {
      try {
        await target.agents.writeWorkspaceFile(agentId, file)
        files += 1
        bytes += Buffer.byteLength(file.content, 'utf-8')
      } catch (err) {
        report.failed.push({ agentId, path: file.path, error: errMsg(err) })
      }
    }

    let carriedSkills = 0
    for (const skill of content.skills) {
      try {
        await target.skills.write(skill, agentId)
        carriedSkills += 1
      } catch (err) {
        report.failed.push({ agentId, path: `skill:${skill.name}`, error: errMsg(err) })
      }
    }

    for (const error of content.errors) {
      report.failed.push({ agentId, path: '<snapshot>', error })
    }

    report.carried.push({ agentId, files, bytes })
    if (carriedSkills > 0 || content.skippedPackageManaged > 0) {
      report.skills.push({ agentId, carried: carriedSkills, skippedPackageManaged: content.skippedPackageManaged })
    }
  }

  log.info('Workspace content carried onto target runtime', {
    agents: report.carried.length,
    files: report.carried.reduce((sum, c) => sum + c.files, 0),
    skills: report.skills.reduce((sum, s) => sum + s.carried, 0),
    skippedExisting: report.skippedExisting.length,
    failed: report.failed.length,
  })
  return report
}
