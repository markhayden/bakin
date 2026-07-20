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
import { removeRunWorktree } from './git-worktree'
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
  /** Bound repo whose worktree lives at `<dir>/repo` — the sweep needs it
   *  for `git worktree remove`; cleared once the checkout is gone. */
  repoPath: z.string().optional(),
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
 * Stamp the settle outcome + a ONE-TIME SCRATCH size (top-level `repo/`
 * checkout excluded — see scratchSizeBytes). First-write-wins: an already
 * settled sidecar is never re-stamped (the force-release path can race a
 * late natural settle). The size feeds the doctor's aggregate (which must
 * never walk the tree at check time) and the sweep's budget accounting.
 */
export function settleRunWorkspace(agentId: string, threadId: string, outcome: string, contentDir?: string): void {
  const dir = runWorkspacePathFor(agentId, threadId, contentDir)
  const sidecar = readRunSidecar(dir)
  if (!sidecar || sidecar.status === 'settled') return // gone or already settled — best-effort
  try {
    writeSidecar(dir, {
      ...sidecar,
      status: 'settled',
      outcome,
      settledAt: new Date().toISOString(),
      sizeBytes: scratchSizeBytes(dir),
    })
  } catch (err) {
    log.warn('Failed to stamp run-workspace settle (sweep grace covers it)', { dir, error: String(err) })
  }
}

/**
 * SCRATCH size only: the top-level `repo/` worktree checkout is deliberately
 * excluded from budget accounting. Checkouts are governed by their own TIME
 * windows (removed at successful settle; 48h on failure) — counting their
 * gigabytes would (a) permanently inflate the aggregate once the checkout is
 * removed (the stamp is one-time), and (b) make the settle-chain walk
 * node_modules-scale trees synchronously on the server event loop
 * (review F5/F7). The budget governs exactly what eviction can delete.
 */
export function scratchSizeBytes(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'repo' && entry.isDirectory()) continue
      const abs = join(dir, entry.name)
      try {
        if (entry.isDirectory()) total += dirSizeBytes(abs)
        else if (entry.isFile()) total += statSync(abs).size
      } catch { /* vanished mid-walk */ }
    }
  } catch { /* dir vanished */ }
  return total
}

/** Record/clear the bound repo on a run's sidecar (worktree lifecycle). */
export function setRunWorkspaceRepo(agentId: string, threadId: string, repoPath: string | null, contentDir?: string): void {
  const dir = runWorkspacePathFor(agentId, threadId, contentDir)
  const sidecar = readRunSidecar(dir)
  if (!sidecar) return
  const { repoPath: _prev, ...rest } = sidecar
  try {
    writeSidecar(dir, repoPath ? { ...rest, repoPath } : rest)
  } catch (err) {
    // Dir removed between read and write (eager cleanup racing the sweep) —
    // never let this escape into the tick (review F8).
    log.warn('Failed to update run-workspace repo marker', { dir, error: String(err) })
  }
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

// ─── Sweep (GC) ─────────────────────────────────────────────────────────────

/** Failed/aborted scratch keeps a flat 30-day window (fixed — post
 *  worktree-death this bounds kilobytes; spec r4 removed the knob). */
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/** A FAILED run's worktree checkout (gigabyte-class) keeps only 48h —
 *  salvage happens at diagnosis time, not weeks later. */
const FAILED_WORKTREE_RETENTION_MS = 48 * 60 * 60 * 1000
/** Bounded work per tick: the sweep must never turn one watchdog tick into
 *  a multi-second IO storm; backlogs drain across ticks. */
const MAX_REMOVALS_PER_SWEEP = 25
const MAX_SIZE_STAMPS_PER_SWEEP = 10

export interface RunWorkspaceSweepDeps {
  /** Live in-flight registry membership by threadId (dispatch-registry). */
  isTurnLive: (threadId: string) => boolean
  /** Store lookup — a deleted task's dirs sweep immediately (post settle/
   *  force-release: the live-registry check above orders this correctly). */
  taskExists: (taskId: string) => boolean
  /** settings.dispatch.runDirRetentionDays (success window). */
  retentionDays: number
  /** settings.dispatch.runDirMaxTotalBytes — hard ceiling; 0/absent = off. */
  maxTotalBytes: number
  /** 2× the watchdog interval: the young-dir grace window. */
  graceMs: number
  now?: number
}

export interface RunWorkspaceStats {
  count: number
  sizeBytes: number
  sweptLastTick: number
  updatedAt: number
}

let lastStats: RunWorkspaceStats | null = null
/** Doctor evidence source — NEVER walks the tree; null until a sweep ran. */
export function getRunWorkspaceStats(): RunWorkspaceStats | null {
  return lastStats
}
export function resetRunWorkspaceStats(): void {
  lastStats = null
  sweepInFlight = false
}

type RunDirClass = 'keep' | 'expired'

/**
 * The collapsed classifier (spec r4 D5): live registry → keep; sidecar
 * `settled` → outcome window (success = retentionDays, anything else = flat
 * 30d); everything else — running-but-unregistered, missing/torn sidecar —
 * keeps a grace window (mtime) then ages out on the failed window. A crash
 * can therefore never strand an unclassifiable dir, and the sweep never
 * deletes a just-allocated dir racing its first send.
 */
function classifyRunDir(
  dir: string,
  sidecar: RunSidecar | null,
  deps: RunWorkspaceSweepDeps,
  now: number,
): RunDirClass {
  if (sidecar && deps.isTurnLive(sidecar.threadId)) return 'keep'
  if (sidecar && !deps.taskExists(sidecar.taskId)) return 'expired'
  if (sidecar?.status === 'settled') {
    const settledAt = Date.parse(sidecar.settledAt ?? sidecar.createdAt)
    const windowMs = sidecar.outcome === 'ok' ? deps.retentionDays * 24 * 60 * 60 * 1000 : FAILED_RETENTION_MS
    return now - settledAt > windowMs ? 'expired' : 'keep'
  }
  // running-unregistered / missing sidecar: grace by mtime, then the failed
  // window from mtime (they were never settled — treat as aborted).
  let mtime = now
  try {
    mtime = statSync(dir).mtimeMs
  } catch {
    return 'expired' // vanished mid-scan
  }
  if (now - mtime <= deps.graceMs) return 'keep'
  return now - mtime > FAILED_RETENTION_MS ? 'expired' : 'keep'
}

let sweepInFlight = false

/**
 * One bounded sweep pass: classify every run dir, remove expired (≤25/tick),
 * lazy-stamp missing sizes on settled sidecars (≤10/tick — crashed dirs must
 * join the aggregate the budget polices), then enforce the size budget by
 * oldest-first eviction over EVICTABLE dirs only (settled/aged — live and
 * within-grace dirs are NEVER evicted; a still-over-budget state is the
 * doctor's to escalate, not ours to fix by killing live work). Single-flight:
 * a pass still running when the next tick fires is skipped, never overlapped.
 */
export async function sweepRunWorkspaces(deps: RunWorkspaceSweepDeps): Promise<RunWorkspaceStats | null> {
  if (sweepInFlight) return lastStats
  sweepInFlight = true
  try {
    const now = deps.now ?? Date.now()
    const root = runWorkspacesRoot()
    let removed = 0
    let stamps = 0
    const survivors: Array<{ dir: string; sidecar: RunSidecar | null; ageAnchor: number; evictable: boolean }> = []

    let agentDirs: string[] = []
    try {
      agentDirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      lastStats = { count: 0, sizeBytes: 0, sweptLastTick: 0, updatedAt: now }
      return lastStats // no root yet — nothing allocated
    }

    for (const agent of agentDirs) {
      let runDirs: string[] = []
      try {
        runDirs = readdirSync(join(root, agent), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        continue
      }
      for (const name of runDirs) {
        const dir = join(root, agent, name)
        let sidecar = readRunSidecar(dir)
        const cls = classifyRunDir(dir, sidecar, deps, now)
        if (cls === 'expired' && removed < MAX_REMOVALS_PER_SWEEP) {
          // Worktree-bearing dirs detach from the bound repo first (`git
          // worktree remove --force` + prune, via the global git mutex); a
          // failed removal (zombie writes, ENOTEMPTY) retries next tick —
          // never "done".
          if (sidecar?.repoPath) {
            const detached = await removeRunWorktree(sidecar.repoPath, join(dir, 'repo'))
            if (!detached) continue
          }
          removeRunWorkspace(dir)
          removed += 1
          continue
        }
        // Worktrees die long before scratch: successful settles remove the
        // checkout at settle-time (this catches crash strays); failed runs
        // keep the checkout a 48h salvage window, scratch+sidecar the 30d.
        if (sidecar?.repoPath && sidecar.status === 'settled') {
          const settledAt = Date.parse(sidecar.settledAt ?? sidecar.createdAt)
          const failedWindowOver = sidecar.outcome !== 'ok' && now - settledAt > FAILED_WORKTREE_RETENTION_MS
          if (sidecar.outcome === 'ok' || failedWindowOver) {
            if (await removeRunWorktree(sidecar.repoPath, join(dir, 'repo'))) {
              setRunWorkspaceRepo(sidecar.agentId, sidecar.threadId, null)
              sidecar = readRunSidecar(dir)
            }
          }
        }
        // Lazy size stamp: settled sidecars missing sizeBytes (pre-crash
        // settles, older allocations) get one walk here, bounded per tick.
        if (sidecar && sidecar.status === 'settled' && sidecar.sizeBytes === undefined && stamps < MAX_SIZE_STAMPS_PER_SWEEP) {
          sidecar = { ...sidecar, sizeBytes: scratchSizeBytes(dir) }
          try {
            const path = join(dir, '.bakin-run.json')
            writeFileSync(`${path}.tmp`, JSON.stringify(sidecar, null, 2))
            renameSync(`${path}.tmp`, path)
            stamps += 1
          } catch {
            // Best-effort — next tick retries.
          }
        }
        const live = sidecar ? deps.isTurnLive(sidecar.threadId) : false
        let ageAnchor = now
        if (sidecar?.settledAt) ageAnchor = Date.parse(sidecar.settledAt)
        else if (sidecar?.createdAt) ageAnchor = Date.parse(sidecar.createdAt)
        else {
          try {
            ageAnchor = statSync(dir).mtimeMs
          } catch { /* keep now */ }
        }
        survivors.push({
          dir,
          sidecar,
          ageAnchor,
          // Checkout-bearing dirs are NEVER budget-evicted: a plain rm of a
          // live worktree strands .git/worktrees metadata — the 48h checkout
          // sweep above detaches first and clears repoPath, THEN the dir
          // becomes evictable. Budget bytes are scratch-only to match.
          evictable: !live && sidecar?.status === 'settled' && !sidecar.repoPath,
        })
      }
    }

    // Size budget: oldest-first eviction over evictable dirs only.
    if (deps.maxTotalBytes > 0) {
      let total = survivors.reduce((sum, s) => sum + (s.sidecar?.sizeBytes ?? 0), 0)
      if (total > deps.maxTotalBytes) {
        const evictable = survivors.filter((s) => s.evictable).sort((a, b) => a.ageAnchor - b.ageAnchor)
        for (const victim of evictable) {
          if (total <= deps.maxTotalBytes || removed >= MAX_REMOVALS_PER_SWEEP) break
          removeRunWorkspace(victim.dir)
          total -= victim.sidecar?.sizeBytes ?? 0
          removed += 1
          const idx = survivors.indexOf(victim)
          if (idx >= 0) survivors.splice(idx, 1)
        }
      }
    }

    lastStats = {
      count: survivors.length,
      sizeBytes: survivors.reduce((sum, s) => sum + (s.sidecar?.sizeBytes ?? 0), 0),
      sweptLastTick: removed,
      updatedAt: now,
    }
    return lastStats
  } finally {
    sweepInFlight = false
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
