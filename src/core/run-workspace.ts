/**
 * Per-run working directories — core side (same-agent-concurrency D2/D5).
 *
 * THE sole owner of run-dir allocation, the `.bakin-run.json` sidecar, and
 * the id encoding. Dispatch allocates here strictly AFTER the ledger claim
 * (the threadId doesn't exist earlier) and OUTSIDE the dispatch state lock;
 * the sweep, doctor, and assets identity all read through this module —
 * never a second sidecar reader/writer anywhere.
 *
 * Dirs live under `~/.bakin/run-workspaces/<agentId>/<encodedRunId>/` —
 * Bakin territory, never a runtime's home (adapter boundary), and excluded
 * from the content watcher (see watcher.ts — an unexcluded worktree +
 * `bun install` fd-exhausts the server).
 */
import { createHash } from 'crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'

import { getContentDir } from '../../packages/core/src/content-dir'
import { createLogger } from './logger'

const log = createLogger('run-workspace')

export const RUN_WORKSPACES_DIR = 'run-workspaces'
const SIDECAR_NAME = '.bakin-run.json'

const RunSidecarSchema = z.object({
  version: z.literal(1),
  threadId: z.string(),
  taskId: z.string(),
  stepId: z.string().optional(),
  agentId: z.string(),
  createdAt: z.string(),
  status: z.enum(['running', 'settled']),
  outcome: z.string().optional(),
  settledAt: z.string().optional(),
  sizeBytes: z.number().optional(),
})

export type RunSidecar = z.infer<typeof RunSidecarSchema>

/**
 * Collision-proof directory name for a threadId: flatten unsafe chars PLUS
 * an 8-char hash of the RAW id — naive `:`→`-` flattening alone is ambiguous
 * (caller-supplied task ids and user-authored workflow stepIds can contain
 * literal dashes that collide with the flattened form).
 */
export function encodeRunId(threadId: string): string {
  const hash = createHash('sha256').update(threadId).digest('hex').slice(0, 8)
  return `${threadId.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${hash}`
}

export function runWorkspacesRoot(contentDir: string = getContentDir()): string {
  return join(contentDir, RUN_WORKSPACES_DIR)
}

export function runWorkspacePathFor(agentId: string, threadId: string, contentDir: string = getContentDir()): string {
  return join(runWorkspacesRoot(contentDir), agentId, encodeRunId(threadId))
}

export interface AllocateRunWorkspaceOpts {
  threadId: string
  taskId: string
  stepId?: string
  agentId: string
  contentDir?: string
}

/**
 * mkdir + sidecar in ONE synchronous block — a run dir is never handed out
 * without a sidecar (`status: 'running'` from birth), so the sweep can
 * always classify what it finds; a crash between the two steps leaves at
 * most an empty dir younger than the sweep's grace window.
 */
export function allocateRunWorkspace(opts: AllocateRunWorkspaceOpts): string {
  const dir = runWorkspacePathFor(opts.agentId, opts.threadId, opts.contentDir)
  mkdirSync(dir, { recursive: true })
  writeSidecar(dir, {
    version: 1,
    threadId: opts.threadId,
    taskId: opts.taskId,
    ...(opts.stepId ? { stepId: opts.stepId } : {}),
    agentId: opts.agentId,
    createdAt: new Date().toISOString(),
    status: 'running',
  })
  return dir
}

/** Tolerant read: missing OR torn (unparseable/invalid) both read as null —
 *  the sweep treats them identically (grace window, then aborted class). */
export function readRunSidecar(dir: string): RunSidecar | null {
  try {
    return RunSidecarSchema.parse(JSON.parse(readFileSync(join(dir, SIDECAR_NAME), 'utf-8')))
  } catch {
    return null
  }
}

/** All sidecar updates are atomic tmp+rename — the sweep never reads a torn
 *  half-write as anything but "missing" (and never deletes young dirs). */
function writeSidecar(dir: string, sidecar: RunSidecar): void {
  const path = join(dir, SIDECAR_NAME)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(sidecar, null, 2))
  renameSync(tmp, path)
}

/**
 * Stamp the settle outcome + a ONE-TIME recursive size. The size feeds the
 * doctor's aggregate (which must never walk the tree at check time) and the
 * sweep's budget accounting.
 */
export function settleRunWorkspace(agentId: string, threadId: string, outcome: string, contentDir?: string): void {
  const dir = runWorkspacePathFor(agentId, threadId, contentDir)
  const sidecar = readRunSidecar(dir)
  if (!sidecar) return // dir already cleaned up (or never allocated) — settle is best-effort
  writeSidecar(dir, {
    ...sidecar,
    status: 'settled',
    outcome,
    settledAt: new Date().toISOString(),
    sizeBytes: dirSizeBytes(dir),
  })
}

/** Eager removal for post-claim failure paths (prep failure, suppressed
 *  claim, task-deleted-mid-allocation, send throw) — the common cases never
 *  wait for aged GC. */
export function removeRunWorkspace(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    log.warn('Failed to remove run workspace (sweep will retry)', { dir, error: String(err) })
  }
}

export function dirSizeBytes(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      try {
        if (entry.isDirectory()) total += dirSizeBytes(abs)
        else if (entry.isFile()) total += statSync(abs).size
      } catch {
        // Entry vanished mid-walk (live turn writing) — skip.
      }
    }
  } catch {
    // Dir vanished mid-walk.
  }
  return total
}
