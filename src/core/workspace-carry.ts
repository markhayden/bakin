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
  /** Snapshot-side read failures and cap omissions (partial snapshot honesty). */
  errors: Array<{ path: string; error: string }>
}

/**
 * Carry byte budgets. Workspaces are WORKING directories — an agent may
 * have cloned repos, datasets, or node_modules in there — while the carry
 * exists for identity-sized text (soul, memory, notes). Everything over
 * budget is a VISIBLE omission in the report, never a silent drop (same
 * doctrine as dispatch.maxWorkflowContextBytes).
 */
export const MAX_CARRY_FILE_BYTES = 1_000_000
export const MAX_CARRY_AGENT_BYTES = 20_000_000
export const MAX_CARRY_AGENT_FILES = 500

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
      let totalBytes = 0
      for (const path of await source.agents.listWorkspaceFiles(agent.id)) {
        if (excluded.some((prefix) => path.startsWith(prefix))) continue
        if (content.files.length >= MAX_CARRY_AGENT_FILES) {
          content.errors.push({ path: '<budget>', error: `carry capped at ${MAX_CARRY_AGENT_FILES} files — remaining workspace files omitted` })
          break
        }
        try {
          const file = await source.agents.readWorkspaceFile(agent.id, path)
          if (!file) {
            content.errors.push({ path, error: 'listed but unreadable — omitted from the carry' })
            continue
          }
          const bytes = Buffer.byteLength(file.content, 'utf-8')
          if (bytes > MAX_CARRY_FILE_BYTES) {
            content.errors.push({ path, error: `${bytes} bytes exceeds the ${MAX_CARRY_FILE_BYTES}-byte per-file carry cap — omitted` })
            continue
          }
          // The workspace-file surface is UTF-8 text; a decoded replacement
          // char means binary content that a copy would mangle.
          if (file.content.includes('\uFFFD')) {
            content.errors.push({ path, error: 'binary/non-UTF-8 content — omitted (workspace-file carry is text-only)' })
            continue
          }
          if (totalBytes + bytes > MAX_CARRY_AGENT_BYTES) {
            content.errors.push({ path: '<budget>', error: `per-agent carry budget (${MAX_CARRY_AGENT_BYTES} bytes) reached at '${path}' — remaining workspace files omitted` })
            break
          }
          totalBytes += bytes
          content.files.push(file)
        } catch (err) {
          content.errors.push({ path, error: errMsg(err) })
        }
      }
    } catch (err) {
      content.errors.push({ path: '<workspace>', error: errMsg(err) })
    }

    try {
      for (const entry of await source.skills.list(agent.id)) {
        // list() may be shallow (OpenClaw) — get() returns files + markers.
        const skill = await source.skills.get(entry.name, agent.id)
        if (!skill) {
          // A skill dir without a readable SKILL.md: carrying the shallow
          // list entry would fabricate an EMPTY skill on the target.
          content.errors.push({ path: `skill:${entry.name}`, error: 'skill unreadable (no SKILL.md) — omitted from the carry' })
          continue
        }
        if (skill.metadata?.installedBy) {
          content.skippedPackageManaged += 1
          continue
        }
        content.skills.push(skill)
      }
    } catch (err) {
      content.errors.push({ path: '<skills>', error: errMsg(err) })
    }
  }
  return snapshot
}

/**
 * The dry-run half of `carryAgentContent`: identical classification and
 * counts (would-carry files/bytes/skills, skipped-existing, snapshot-side
 * errors) with ZERO writes. Kept next to the real carry so the preview can
 * never drift from what a real switch would do.
 */
export function previewWorkspaceCarry(
  snapshot: AgentContentSnapshot,
  carriedIds: string[],
  existingIds: string[],
): WorkspaceCarryReport {
  const report: WorkspaceCarryReport = { carried: [], skills: [], skippedExisting: [], failed: [] }

  for (const agentId of existingIds) {
    const content = snapshot.agents.get(agentId)
    if (content && (content.files.length > 0 || content.skills.length > 0 || content.errors.length > 0)) {
      report.skippedExisting.push(agentId)
    }
  }

  for (const agentId of carriedIds) {
    const content = snapshot.agents.get(agentId)
    if (!content) continue
    report.carried.push({
      agentId,
      files: content.files.length,
      bytes: content.files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf-8'), 0),
    })
    if (content.skills.length > 0 || content.skippedPackageManaged > 0) {
      report.skills.push({ agentId, carried: content.skills.length, skippedPackageManaged: content.skippedPackageManaged })
    }
    for (const { path, error } of content.errors) {
      report.failed.push({ agentId, path, error })
    }
  }

  return report
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
    // Errors count as content: an unreadable source agent must not vanish
    // from the report just because its target twin already exists.
    if (content && (content.files.length > 0 || content.skills.length > 0 || content.errors.length > 0)) {
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

    for (const { path, error } of content.errors) {
      report.failed.push({ agentId, path, error })
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
