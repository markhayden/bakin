/**
 * THE shared download-verify-commit primitive (#889).
 *
 * Every pinned-artifact installer (capability-pack bins, model files, the
 * media sharp store) composes these three steps instead of hand-rolling the
 * recipe: stream a download to disk with a sha256 pin, optionally pull a
 * member out of a tar.gz, and verify-then-commit into the final path with an
 * atomic rename. Every artifact transfer rides it — the antfly engine, Whiskit
 * releases and plugin sources included (#895); progress, stalls and retries
 * surface as `DownloadEvent`s that `opTransfer` maps onto an operation.
 *
 * Downloads STREAM to disk — never buffered in memory (model files are ~GB).
 * A failed leg always deletes its partial file; the target path is only ever
 * touched by the final rename.
 */
import { spawn } from 'child_process'
import { createReadStream, createWriteStream, chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import type { OperationContext } from '@makinbakin/sdk/types'
import { createLogger } from '../logger'

const log = createLogger('net-download')

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000
const EXTRACT_TIMEOUT_MS = 15_000

/** Streaming sha256 of a file on disk. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * Transfer events (#895): the attempt counter, byte progress, a stall noticed
 * on a body read, and each fresh-request retry with its classified reason.
 * `opTransfer` maps them onto an operation; the order is pinned by tests.
 */
export type DownloadEvent =
  | { type: 'attempt'; n: number; of: number }
  | { type: 'bytes'; received: number; total: number | null }
  | { type: 'stalled'; afterMs: number }
  | { type: 'retry'; n: number; of: number; reason: DownloadFailureReason; detail: string }

export type DownloadFailureReason = 'stalled' | 'deadline' | 'http' | 'network'

export interface TransferOptions {
  /** Wall-clock deadline for one whole attempt (headers + body). Default 120s. */
  timeoutMs?: number
  /**
   * No-bytes window: an attempt whose body delivers NOTHING for this long is
   * a stalled transfer and fails (margo 2026-09-21: a wedged registry stream
   * hung every installer forever — `Bun.write(dest, res)` never honors the
   * fetch abort signal once body streaming starts, so the deadline MUST be
   * enforced by hand around each read — minimal repro + issue text in
   * tasks/bun-write-abort-repro/; TODO(#896): link the upstream oven-sh/bun
   * issue once filed). Default 30s.
   */
  stallTimeoutMs?: number
  /**
   * Extra attempts after a failed one — each retry is a FRESH request (a
   * stalled keep-alive connection is the observed production failure mode;
   * a fresh attempt typically succeeds). Checksum mismatches and aborts never
   * retry. Default 1.
   */
  retries?: number
  /**
   * Fetch implementation. Defaults to Bun's NATIVE fetch — the test
   * preload's happy-dom fetch cannot drive real sockets (CLAUDE.md).
   */
  fetchImpl?: typeof fetch
  /** Human prefix for error messages, e.g. `Binary "ripgrep"`. */
  label?: string
  /** Cancels the transfer: no retry, the partial is removed, the abort reason is rethrown. */
  signal?: AbortSignal
  onEvent?: (event: DownloadEvent) => void
}

export interface DownloadToFileOptions extends TransferOptions {
  /** Lowercase hex sha256 pin. Mismatch deletes the file and throws `DownloadChecksumError`. */
  sha256?: string
}

export interface DownloadResult {
  /** sha256 of the downloaded bytes (== the pin when one was given). */
  sha256: string
  bytes: number
}

const DEFAULT_STALL_TIMEOUT_MS = 30_000

/** The bytes did not match the pin. Deterministic, so never retried. */
export class DownloadChecksumError extends Error {
  constructor(message: string, readonly expected: string, readonly actual: string, readonly url: string) {
    super(message)
    this.name = 'DownloadChecksumError'
  }
}

/** A failed attempt, classified for the retry event. */
class TransferAttemptError extends Error {
  constructor(message: string, readonly reason: DownloadFailureReason) {
    super(message)
  }
}

class AbortedError extends Error {
  constructor(readonly reason: unknown) {
    super('aborted')
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortedError(signal.reason ?? new Error('Aborted'))
}

/** Reject when a body read outlives its stall window or the attempt deadline, or the caller aborts. */
async function readWithDeadlines<T>(
  read: Promise<T>,
  stallTimeoutMs: number,
  deadlineAt: number,
  label: string,
  signal: AbortSignal | undefined,
  onStall: () => void,
): Promise<T> {
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) throw new TransferAttemptError(`${label} download failed: attempt deadline exceeded mid-transfer`, 'deadline')
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      if (remaining <= stallTimeoutMs) {
        reject(new TransferAttemptError(`${label} download failed: attempt deadline exceeded mid-transfer`, 'deadline'))
        return
      }
      onStall()
      reject(new TransferAttemptError(`${label} download stalled: no data for ${Math.round(stallTimeoutMs / 1000)}s — transfer abandoned`, 'stalled'))
    }, Math.min(stallTimeoutMs, remaining))
    if (signal) {
      onAbort = () => reject(new AbortedError(signal.reason ?? new Error('Aborted')))
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
  try {
    return await Promise.race([read, guard])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

/** One attempt: request, then stream every chunk to `onChunk` under the stall/deadline/abort guards. */
async function transferAttempt(
  url: string,
  options: TransferOptions,
  onChunk: (chunk: Uint8Array) => Promise<void> | void,
): Promise<number> {
  const label = options.label ?? 'Download'
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  const fetchImpl = options.fetchImpl
    ?? (Bun as unknown as { fetch?: typeof fetch }).fetch
    ?? fetch
  const deadlineAt = Date.now() + timeoutMs

  // One controller per attempt, linked by hand to the deadline and the
  // caller's signal (AbortSignal.any is unreliable under the test preload).
  const controller = new AbortController()
  // Classify by the timer having fired, never by comparing clocks: setTimeout
  // runs on a monotonic clock and can fire before Date.now() reaches deadlineAt.
  let deadlineFired = false
  const deadline = setTimeout(() => {
    deadlineFired = true
    controller.abort(new Error('The operation timed out'))
  }, timeoutMs)
  const forward = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', forward, { once: true })
  try {
    let res: Response
    try {
      res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' })
    } catch (err) {
      throwIfAborted(options.signal)
      throw new TransferAttemptError(
        `${label} download failed: ${err instanceof Error ? err.message : String(err)} (${url})`,
        deadlineFired ? 'deadline' : 'network',
      )
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      // A fetch that did not follow (some fakes, `redirect: manual` shims) — follow once here.
      return await transferAttempt(new URL(res.headers.get('location')!, url).toString(), options, onChunk)
    }
    if (!res.ok) {
      throw new TransferAttemptError(`${label} download failed: ${res.status} ${res.statusText} (${url})`, 'http')
    }
    if (!res.body) {
      throw new TransferAttemptError(`${label} download failed: response carried no body (${url})`, 'http')
    }
    const declaredLength = Number(res.headers.get('content-length'))
    const totalBytes = Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : null

    // Manual chunk loop — never `Bun.write(dest, res)`: it ignores the abort
    // signal during body streaming, so a wedged connection hangs forever.
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    let received = 0
    try {
      for (;;) {
        const chunk = await readWithDeadlines(reader.read(), stallTimeoutMs, deadlineAt, label, options.signal, () => {
          options.onEvent?.({ type: 'stalled', afterMs: stallTimeoutMs })
        })
        if (chunk.done) break
        received += chunk.value.byteLength
        await onChunk(chunk.value)
        options.onEvent?.({ type: 'bytes', received, total: totalBytes })
        throwIfAborted(options.signal)
      }
    } catch (err) {
      void reader.cancel().catch(() => { /* already broken */ })
      // The deadline timer and the read guard can come due together; when the
      // deadline's abort lands first the read rejects with the raw abort reason.
      if (deadlineFired && !(err instanceof TransferAttemptError) && !(err instanceof AbortedError)) {
        throw new TransferAttemptError(`${label} download failed: attempt deadline exceeded mid-transfer`, 'deadline')
      }
      throw err
    }
    return received
  } finally {
    clearTimeout(deadline)
    options.signal?.removeEventListener('abort', forward)
  }
}

/**
 * The retry loop shared by files and text. Each attempt is announced; a
 * failed one is classified and retried with a fresh request unless it was a
 * checksum mismatch or an abort. `cleanup` runs after every failed attempt.
 */
async function withRetries<T>(options: TransferOptions, attemptFn: () => Promise<T>, cleanup: () => void): Promise<T> {
  const label = options.label ?? 'Download'
  const attempts = 1 + Math.max(0, options.retries ?? 1)
  throwIfAbortedPublic(options.signal)
  let lastError: unknown
  for (let n = 1; n <= attempts; n++) {
    options.onEvent?.({ type: 'attempt', n, of: attempts })
    try {
      return await attemptFn()
    } catch (err) {
      cleanup()
      if (err instanceof AbortedError) throw err.reason
      if (err instanceof DownloadChecksumError) throw err
      lastError = err
      if (n < attempts) {
        const reason: DownloadFailureReason = err instanceof TransferAttemptError ? err.reason : 'network'
        const detail = err instanceof Error ? err.message : String(err)
        log.warn(`${label} download attempt ${n}/${attempts} failed — retrying with a fresh request`, { error: detail, reason })
        options.onEvent?.({ type: 'retry', n: n + 1, of: attempts, reason, detail })
      }
    }
  }
  throw lastError
}

function throwIfAbortedPublic(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
}

/**
 * Stream a URL to `destPath` (parent dirs created), then sha256-verify
 * against the pin. Stall-proof by construction: every body read races the
 * stall window and the attempt deadline, transient failures get fresh-
 * request retries, and any failure deletes the partial file and throws.
 */
export async function downloadToFile(url: string, destPath: string, options: DownloadToFileOptions = {}): Promise<DownloadResult> {
  const label = options.label ?? 'Download'
  mkdirSync(dirname(destPath), { recursive: true })
  return withRetries(options, async () => {
    const sink = createWriteStream(destPath)
    const sinkDone = new Promise<void>((resolve, reject) => {
      sink.once('close', resolve)
      sink.once('error', reject)
    })
    let bytes: number
    try {
      bytes = await transferAttempt(url, options, async (chunk) => {
        if (!sink.write(chunk)) {
          await new Promise<void>((resolve, reject) => {
            sink.once('drain', resolve)
            sink.once('error', reject)
          })
        }
      })
      sink.end()
      await sinkDone
    } catch (err) {
      // The sink opens asynchronously; when an attempt fails fast the caller's
      // cleanup can remove the directory before that open runs. The abandoned
      // stream's late error is expected — observe it so it never surfaces as
      // an unhandled rejection.
      sinkDone.catch((sinkErr: unknown) => log.debug('abandoned download sink settled with an error', { destPath, error: String(sinkErr) }))
      sink.destroy()
      throw err
    }
    const actual = await sha256File(destPath)
    if (options.sha256 && actual !== options.sha256.toLowerCase()) {
      throw new DownloadChecksumError(
        `${label} checksum mismatch: expected ${options.sha256.toLowerCase()}, got ${actual} — refusing to install (${url})`,
        options.sha256.toLowerCase(),
        actual,
        url,
      )
    }
    return { sha256: actual, bytes }
  }, () => {
    try { rmSync(destPath, { force: true }) } catch { log.warn(`partial download cleanup failed for ${destPath}`) }
  })
}

/**
 * Fetch a small text artifact (release indexes, manifests) through the same
 * stall/deadline/retry/abort machinery. Follows redirects.
 */
export async function downloadText(url: string, options: TransferOptions = {}): Promise<string> {
  return withRetries(options, async () => {
    const chunks: Uint8Array[] = []
    await transferAttempt(url, options, (chunk) => { chunks.push(chunk) })
    return Buffer.concat(chunks).toString('utf-8')
  }, () => {})
}

/** Map transfer events onto an operation stage (and item). */
export function opTransfer(op: Pick<OperationContext, 'bytes' | 'attempt' | 'log'>, stageId: string, itemId?: string): (event: DownloadEvent) => void {
  return (event) => {
    switch (event.type) {
      case 'bytes':
        op.bytes(stageId, { received: event.received, total: event.total }, itemId)
        return
      case 'stalled':
        op.log(`${itemId ? `${itemId}: ` : ''}no data for ${Math.round(event.afterMs / 1000)}s`, 'warn')
        return
      case 'retry':
        op.attempt(stageId, { n: event.n, of: event.of, reason: event.reason, detail: event.detail })
        return
      case 'attempt':
        return
    }
  }
}

export interface TarOptions {
  timeoutMs?: number
  label?: string
  signal?: AbortSignal
  /** Each stderr line from tar (operations route it to `op.output`). */
  onOutput?: (line: string) => void
}

/** Run tar with a deadline, an abort signal and line-streamed stderr. */
function runTar(args: string[], options: TarOptions): Promise<void> {
  throwIfAbortedPublic(options.signal)
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let pending = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? EXTRACT_TIMEOUT_MS)
    const onAbort = () => child.kill('SIGTERM')
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) options.onOutput?.(line)
    })
    child.once('error', (err) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (pending.trim()) options.onOutput?.(pending)
      if (options.signal?.aborted) return reject(options.signal.reason ?? new Error('Aborted'))
      if (code === 0) return resolve()
      reject(new Error(signal ? `tar killed by ${signal} (timed out)` : `tar exited ${code}: ${stderr.trim()}`))
    })
  })
}

export type ExtractTarMemberOptions = TarOptions

/**
 * Extract ONE member from a tar.gz into `destDir` and return its path.
 * '--' terminates option parsing — a member name can never be read as a tar
 * option (argument-injection hardening; manifest schemas also ban '-').
 */
export async function extractTarMember(
  archivePath: string,
  member: string,
  destDir: string,
  options: ExtractTarMemberOptions = {},
): Promise<string> {
  const label = options.label ?? 'Archive'
  try {
    await runTar(['-xzf', archivePath, '-C', destDir, '--', member], options)
    const memberPath = join(destDir, member)
    if (!existsSync(memberPath)) {
      throw new Error(`member "${member}" not found in archive`)
    }
    return memberPath
  } catch (err) {
    if (options.signal?.aborted) throw err
    throw new Error(`${label} extraction failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface ExtractTarballOptions extends TarOptions {
  /** Leading path components to strip (npm tarballs nest under `package/`). */
  stripComponents?: number
}

/**
 * Extract a WHOLE tar.gz into `destDir` (created if missing). npm registry
 * tarballs pass `stripComponents: 1` to drop their `package/` root.
 */
export async function extractTarball(
  archivePath: string,
  destDir: string,
  options: ExtractTarballOptions = {},
): Promise<void> {
  const label = options.label ?? 'Archive'
  try {
    throwIfAbortedPublic(options.signal)
    mkdirSync(destDir, { recursive: true })
    const args = ['-xzf', archivePath, '-C', destDir]
    if (options.stripComponents) args.push(`--strip-components=${options.stripComponents}`)
    await runTar(args, options)
  } catch (err) {
    if (options.signal?.aborted) throw err
    throw new Error(`${label} extraction failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface CommitFileAtomicOptions {
  /** chmod applied to the temp file before verify/rename (e.g. 0o755). */
  mode?: number
  /**
   * Verify-then-commit hook: runs against the TEMP path; throwing aborts the
   * commit — a broken artifact must never shadow a working install. The hook
   * owns its error message (callers keep their domain wording).
   */
  verify?: (tmpPath: string) => Promise<void>
}

/**
 * Atomically promote a fully-written temp file to its target name. On any
 * failure the temp file is removed and the existing target is untouched.
 */
export async function commitFileAtomic(tmpPath: string, target: string, options: CommitFileAtomicOptions = {}): Promise<void> {
  try {
    if (options.mode !== undefined) chmodSync(tmpPath, options.mode)
    if (options.verify) await options.verify(tmpPath)
    mkdirSync(dirname(target), { recursive: true })
    renameSync(tmpPath, target)
  } catch (err) {
    try { rmSync(tmpPath, { force: true }) } catch { log.warn(`temp cleanup failed for ${tmpPath}`) }
    throw err
  }
}
