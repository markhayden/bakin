/**
 * Repo binding for dispatch tasks (same-agent-concurrency D6): which git
 * repo, if any, a task's turns should run inside. Mirrors the brandId
 * architecture — a task-level `repoPath` override wins, else the task's
 * project resolves through the feature-detected `projects.getRepo` hook
 * (registered by the installed projects plugin; absent = unbound).
 *
 * Validation is core-owned and NEVER bypassable by a task-level override:
 * the path must be a git repo INSIDE the git plugin's `allowedRepoRoots`
 * allowlist (read from its persisted settings; empty/unset = nothing
 * bindable — an explicit operator decision, never a hardcoded default).
 */
import { readFileSync } from 'fs'
import { join, sep } from 'path'

import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { getContentDir } from '../../packages/core/src/content-dir'
import { expandRepoPath, isGitRepo } from './git-worktree'
import { createLogger } from './logger'

const log = createLogger('repo-binding')
const hooks = () => getHookRegistry()

/** Structural binding failure — the task must not fire without its checkout. */
export class BoundRepoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BoundRepoError'
  }
}

function allowedRepoRoots(): string[] {
  try {
    const raw = JSON.parse(readFileSync(join(getContentDir(), 'plugin-settings', 'git.json'), 'utf-8')) as { allowedRepoRoots?: unknown }
    if (Array.isArray(raw.allowedRepoRoots)) {
      // The git plugin's list-field persists entries as `{ path }` objects
      // (its own reader accepts both shapes) — accept both here too, or a
      // UI-configured allowlist would read as empty from core.
      return raw.allowedRepoRoots
        .map((entry) => typeof entry === 'string' ? entry : (entry as { path?: unknown } | null)?.path)
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map(expandRepoPath)
    }
  } catch {
    // No settings file / unparseable — treated as unconfigured below.
  }
  return []
}

export interface RepoBinding {
  repoPath: string
  source: 'task' | 'project'
}

/**
 * Resolve + validate a task's repo binding. Null = unbound (the common
 * case). Throws BoundRepoError when a binding EXISTS but is unusable —
 * a bound task never fires without its checkout.
 */
export async function resolveRepoBinding(task: { id: string; repoPath?: unknown; projectId?: unknown }): Promise<RepoBinding | null> {
  let raw: string | undefined
  let source: RepoBinding['source'] = 'task'
  if (typeof task.repoPath === 'string' && task.repoPath.trim()) {
    raw = task.repoPath.trim()
  } else if (typeof task.projectId === 'string' && task.projectId && hooks().has('projects.getRepo')) {
    try {
      const fromProject = await hooks().invoke<string | undefined>('projects.getRepo', { projectId: task.projectId })
      if (typeof fromProject === 'string' && fromProject.trim()) {
        raw = fromProject.trim()
        source = 'project'
      }
    } catch (err) {
      log.warn('projects.getRepo failed; treating the task as bound-but-unresolvable', { taskId: task.id, err: String(err) })
      throw new BoundRepoError('projects.getRepo failed — refusing to dispatch the bound task without its repo')
    }
  }
  if (!raw) return null

  const repoPath = expandRepoPath(raw)
  const roots = allowedRepoRoots()
  if (roots.length === 0) {
    throw new BoundRepoError(`Repo binding refused: git.allowedRepoRoots is not configured (Settings → Git). Bound repo: ${repoPath}`)
  }
  if (!roots.some((root) => repoPath === root || repoPath.startsWith(root + sep))) {
    throw new BoundRepoError(`Repo binding refused: ${repoPath} is outside the configured allowedRepoRoots`)
  }
  if (!isGitRepo(repoPath)) {
    throw new BoundRepoError(`Repo binding refused: ${repoPath} is not a git repository`)
  }
  return { repoPath, source }
}
