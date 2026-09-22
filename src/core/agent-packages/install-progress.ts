/**
 * Install progress jobs (#895 — margo, 2026-09-21): a 940MB model download
 * behind a button that said "Installing…" for minutes, plus a 120s client
 * abort that failed the dialog while the server kept installing. Long
 * installs now run as JOBS — the POST returns a job handle immediately, the
 * engine emits staged progress over the shared SSE bus, and a status
 * endpoint carries the final result (and survives missed events/reloads).
 *
 * Mirrors the search-rebuild precedent (202 + job handle + SSE + poll),
 * with the plugin-event envelope so `usePluginEvent` consumes it with no
 * translation arm:
 *   packages.install_started  { jobId, title, kind }
 *   packages.install_progress { jobId, stage, message, item?, current?, total?, receivedBytes?, totalBytes? }
 *   packages.install_done     { jobId }
 *   packages.install_failed   { jobId, error }
 *
 * Jobs are coordination state, in-memory by design (like reindex jobs): a
 * server restart orphans the UI politely via the poll's 404 → "outcome
 * unknown — refresh". Never a durable ledger row (coordination ≠ content).
 */
import { randomUUID } from 'node:crypto'
import { broadcast } from '../sse'
import { createLogger } from '../logger'

const log = createLogger('install-jobs')

export type InstallStage =
  | 'fetch-source'
  | 'validate'
  | 'dependencies'
  | 'project'
  | 'bins'
  | 'models'
  | 'npm'
  | 'agent'
  | 'finalize'

export interface InstallProgressUpdate {
  stage: InstallStage
  /** Human line, e.g. `Downloading model tdt-0.6b-v3 (1/1)`. */
  message: string
  /** Current artifact label (tarball/bin/model name). */
  item?: string
  /** Item counter within the stage (1-based). */
  current?: number
  total?: number
  receivedBytes?: number
  totalBytes?: number | null
}

export type InstallProgressFn = (update: InstallProgressUpdate) => void

export type InstallJobKind = 'package' | 'agent-package' | 'plugin'

export interface InstallJob {
  id: string
  kind: InstallJobKind
  title: string
  status: 'running' | 'done' | 'failed'
  startedAt: string
  finishedAt?: string
  /** Last progress update — poll fallback for missed SSE. */
  lastUpdate?: InstallProgressUpdate
  /** The exact response body the blocking endpoint would have returned. */
  result?: unknown
  /** HTTP status the blocking endpoint would have used (e.g. 409 collision). */
  resultStatus?: number
  error?: string
}

const jobs = new Map<string, InstallJob>()
/** Completed jobs linger for pickup, then sweep (UI polls within seconds). */
const JOB_TTL_MS = 15 * 60_000
const MAX_JOBS = 50

/** Emit at most one bytes-only update per item per this window. */
const BYTE_THROTTLE_MS = 500

function emit(event: string, data: Record<string, unknown>): void {
  try {
    broadcast({ type: 'plugin-event', event, ...data, timestamp: new Date().toISOString() })
  } catch {
    // SSE not up (tests/CLI) — progress is best-effort display only.
  }
}

function sweep(): void {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && new Date(job.finishedAt ?? job.startedAt).getTime() < cutoff) jobs.delete(id)
  }
  if (jobs.size > MAX_JOBS) {
    for (const [id, job] of jobs) {
      if (job.status !== 'running') jobs.delete(id)
      if (jobs.size <= MAX_JOBS) break
    }
  }
}

export function getInstallJob(id: string): InstallJob | null {
  return jobs.get(id) ?? null
}

export interface StartInstallJobInput {
  kind: InstallJobKind
  title: string
  /**
   * The install body. Return value becomes `job.result`; throw marks the
   * job failed. Return `{ __status }` alongside to carry a non-200 HTTP
   * status (e.g. the 409 collision contract).
   */
  run: (progress: InstallProgressFn) => Promise<{ body: unknown; status?: number }>
}

export function startInstallJob(input: StartInstallJobInput): InstallJob {
  sweep()
  const job: InstallJob = {
    id: randomUUID().slice(0, 8),
    kind: input.kind,
    title: input.title,
    status: 'running',
    startedAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)
  emit('packages.install_started', { jobId: job.id, title: job.title, kind: job.kind })

  const lastByteEmit = new Map<string, number>()
  const progress: InstallProgressFn = (update) => {
    job.lastUpdate = update
    // Byte-only churn is throttled per item; stage/message changes always emit.
    if (update.receivedBytes !== undefined) {
      const key = `${update.stage}:${update.item ?? ''}`
      const last = lastByteEmit.get(key) ?? 0
      const terminal = update.totalBytes != null && update.receivedBytes >= update.totalBytes
      if (!terminal && Date.now() - last < BYTE_THROTTLE_MS) return
      lastByteEmit.set(key, Date.now())
    }
    emit('packages.install_progress', { jobId: job.id, ...update })
  }

  void (async () => {
    try {
      const outcome = await input.run(progress)
      job.result = outcome.body
      job.resultStatus = outcome.status ?? 200
      job.status = 'done'
      job.finishedAt = new Date().toISOString()
      emit('packages.install_done', { jobId: job.id })
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err)
      job.status = 'failed'
      job.finishedAt = new Date().toISOString()
      emit('packages.install_failed', { jobId: job.id, error: job.error })
      log.warn('install job failed', { jobId: job.id, title: job.title, error: job.error })
    }
  })()

  return job
}
