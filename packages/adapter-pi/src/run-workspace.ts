/**
 * Per-run working directories (same-agent-concurrency D2, adapter side).
 *
 * When dispatch hands a turn `MessageArgs.runWorkspace`, ONLY the session's
 * tool-execution cwd moves there — the resource loader, settings manager,
 * and session store stay pinned to the agent workspace, so project context
 * (AGENTS.md), skills, extensions, and prompt assembly are byte-identical
 * to a workspace turn. What the run dir needs seeded is exactly one thing:
 * the agent's own root markdown files (identity + memory), symlinked in so
 * cwd-relative reads/writes of THOSE names keep flowing to the real
 * workspace. Everything else the turn writes is scratch and stays isolated.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync } from 'fs'
import { join } from 'path'

import { getAgentWorkspaceDir } from './home'

/**
 * A runWorkspace that is a git checkout (bound-task worktree, D6) is NEVER
 * seeded: symlinks inside a repo working tree would show as untracked files
 * an agent could commit into the deliverable branch, and would break clean
 * worktree removal — the spec's own Never-boundary. Bound turns read their
 * identity through the prompt (loader stays workspace-pinned) and write
 * memory via absolute paths per their dispatch guidance.
 */
function isGitCheckout(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

function workspaceRootMarkdownNames(workspace: string): string[] {
  try {
    return readdirSync(workspace, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * Idempotent: creates the run dir and symlinks each workspace-root `*.md`
 * into it (skipping names already present). Best-effort per link — a failed
 * symlink degrades to "that file reads via the prompt only", never a failed
 * turn.
 */
export function seedRunWorkspace(agentId: string, runWorkspace: string): void {
  const workspace = getAgentWorkspaceDir(agentId)
  mkdirSync(runWorkspace, { recursive: true })
  if (isGitCheckout(runWorkspace)) return
  for (const name of workspaceRootMarkdownNames(workspace)) {
    const linkPath = join(runWorkspace, name)
    try {
      lstatSync(linkPath)
    } catch {
      try {
        symlinkSync(join(workspace, name), linkPath)
      } catch {
        // Best-effort (e.g. exotic fs) — the workspace copy stays canonical.
      }
    }
  }
}

/**
 * Settle-time severed-symlink recovery: a rename-style atomic write (temp
 * file + mv — a common agent habit) REPLACES a symlink with a regular file,
 * silently stranding what should have been a workspace write. For every
 * run-dir root `*.md` that is a regular file AND has a workspace-root
 * counterpart, copy the content back (last-write-wins — decision record 4).
 * New `*.md` names with no workspace counterpart are scratch and stay put.
 */
export function recoverSeededLinks(
  agentId: string,
  runWorkspace: string,
  warn?: (message: string, data?: Record<string, unknown>) => void,
): void {
  if (isGitCheckout(runWorkspace)) return
  const workspace = getAgentWorkspaceDir(agentId)
  const workspaceNames = new Set(workspaceRootMarkdownNames(workspace))
  for (const name of workspaceRootMarkdownNames(runWorkspace)) {
    if (!workspaceNames.has(name)) continue
    const runPath = join(runWorkspace, name)
    try {
      if (lstatSync(runPath).isSymbolicLink()) continue
      copyFileSync(runPath, join(workspace, name))
      warn?.('adapter-pi: recovered severed run-workspace link (rename-style write)', {
        agentId,
        file: name,
        runWorkspace,
      })
    } catch {
      // Recovery is best-effort; the run dir retains the bytes either way.
    }
  }
}
