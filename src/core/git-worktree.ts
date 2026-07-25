/**
 * Core git-worktree machinery for repo-bound tasks (same-agent-concurrency
 * D6). Git is runtime-neutral, so this lives in core, not an adapter.
 *
 * ONE global mutex serializes EVERY git mutation this module performs —
 * add, remove, prune — across all repos: concurrent `worktree add`s contend
 * on `.git` locks, and `prune` scanning `.git/worktrees` mid-add is a
 * git-version-dependent bet we don't take. A per-repo queue is unneeded
 * complexity at 1-3 bound repos (spec r4; upgrade only if contention is
 * ever observed).
 *
 * Reconciliation is branch-per-run: `bakin/run/task-<id>-d<seq>` — the
 * `/`-separated `run` namespace can never collide with the git PLUGIN's
 * `-`-joined `bakin/<slug>-<agent>` names. Branches are never auto-deleted
 * (the branch IS the deliverable; the checkout is scratch).
 */
import { execFile } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { promisify } from 'util'

import { createLogger } from './logger'

const execFileAsync = promisify(execFile)
const log = createLogger('git-worktree')

// The one global git mutex (promise chain; errors never wedge it).
let gitQueue: Promise<unknown> = Promise.resolve()
function withGitMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = gitQueue.then(fn, fn)
  gitQueue = next.catch(() => {})
  return next
}

async function git(repo: string, args: string[], timeoutMs = 120_000): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim()
}

/** Branch name for a run: threadId `task:<id>:d<seq>` → `bakin/run/task-<id>-d<seq>`. */
export function runBranchName(threadId: string): string {
  return `bakin/run/${threadId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

export function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'))
}

/**
 * Expand `~/` and resolve. Mirrors the git plugin's path handling so the
 * allowlist check compares like with like.
 */
export function expandRepoPath(p: string): string {
  return resolve(p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
}

/**
 * Materialize the run's worktree at `<runDir>/repo` on a fresh
 * branch-per-run. Throws on failure — dispatch surfaces it as a typed
 * transient failure (a bound task never fires without its checkout).
 */
export async function addRunWorktree(repoPath: string, runDir: string, threadId: string): Promise<{ checkoutDir: string; branch: string }> {
  const branch = runBranchName(threadId)
  const checkoutDir = join(runDir, 'repo')
  await withGitMutex(async () => {
    await git(repoPath, ['worktree', 'add', checkoutDir, '-b', branch])
  })
  return { checkoutDir, branch }
}

/**
 * Remove a run's worktree checkout. ALWAYS `--force`: agent build artifacts
 * (and any untracked files) block a plain remove — the branch survives, the
 * checkout is scratch. Repo gone/moved ⇒ plain recursive delete of the
 * checkout dir; prune is best-effort. Returns false when removal failed and
 * should be retried next tick (ENOTEMPTY-style races with dying processes).
 */
export async function removeRunWorktree(repoPath: string, checkoutDir: string): Promise<boolean> {
  return withGitMutex(async () => {
    if (!isGitRepo(repoPath)) {
      // Bound repo deleted/moved: the worktree dir is just files now.
      try {
        rmSync(checkoutDir, { recursive: true, force: true })
        return true
      } catch (err) {
        log.warn('Worktree dir removal failed (repo gone); will retry', { checkoutDir, error: String(err) })
        return false
      }
    }
    try {
      await git(repoPath, ['worktree', 'remove', '--force', checkoutDir])
    } catch (err) {
      // A zombie process recreating files mid-remove can fail it — never
      // treat as done; the sweep retries next tick.
      if (existsSync(checkoutDir)) {
        log.warn('git worktree remove failed; will retry next tick', { checkoutDir, error: String(err) })
        return false
      }
    }
    try {
      await git(repoPath, ['worktree', 'prune'])
    } catch (err) {
      log.warn('git worktree prune failed (best-effort)', { repoPath, error: String(err) })
    }
    return true
  })
}

/** Advisory count of accumulated run branches (doctor evidence — no deletion). */
export async function countRunBranches(repoPath: string): Promise<number> {
  try {
    const out = await withGitMutex(() => git(repoPath, ['branch', '--list', 'bakin/run/*', '--format=%(refname:short)']))
    return out ? out.split('\n').filter(Boolean).length : 0
  } catch {
    return 0
  }
}
