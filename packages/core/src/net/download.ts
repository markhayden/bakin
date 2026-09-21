/**
 * THE shared download-verify-commit primitive (#889).
 *
 * Every pinned-artifact installer (capability-pack bins, model files, the
 * media sharp store) composes these three steps instead of hand-rolling the
 * recipe: stream a download to disk with a sha256 pin, optionally pull a
 * member out of a tar.gz, and verify-then-commit into the final path with an
 * atomic rename. The antfly engine installer still carries its own copy —
 * refitting it is ticketed separately (service-lifecycle entanglement).
 *
 * Downloads STREAM to disk — never buffered in memory (model files are ~GB).
 * A failed leg always deletes its partial file; the target path is only ever
 * touched by the final rename.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createReadStream, createWriteStream, chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { createLogger } from '../logger'

const log = createLogger('net-download')
const execFileAsync = promisify(execFile)

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000
const EXTRACT_TIMEOUT_MS = 15_000

/** Streaming sha256 of a file on disk. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export interface DownloadToFileOptions {
  /** Lowercase hex sha256 pin. Mismatch deletes the file and throws. */
  sha256?: string
  /** Wall-clock deadline for one whole attempt (headers + body). Default 120s. */
  timeoutMs?: number
  /**
   * No-bytes window: an attempt whose body delivers NOTHING for this long is
   * a stalled transfer and fails (margo 2026-09-21: a wedged registry stream
   * hung every installer forever — `Bun.write(dest, res)` never honors the
   * fetch abort signal once body streaming starts, so the deadline MUST be
   * enforced by hand around each read). Default 30s.
   */
  stallTimeoutMs?: number
  /**
   * Extra attempts after a failed one — each retry is a FRESH request (a
   * stalled keep-alive connection is the observed production failure mode;
   * a fresh attempt typically succeeds). Checksum mismatches never retry:
   * a wrong pin is deterministic. Default 1.
   */
  retries?: number
  /**
   * Fetch implementation. Defaults to Bun's NATIVE fetch — the test
   * preload's happy-dom fetch cannot drive real sockets (CLAUDE.md).
   */
  fetchImpl?: typeof fetch
  /** Human prefix for error messages, e.g. `Binary "ripgrep"`. */
  label?: string
  /** Called after each chunk with received bytes and the declared total (null when unknown). */
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void
}

export interface DownloadResult {
  /** sha256 of the downloaded bytes (== the pin when one was given). */
  sha256: string
  bytes: number
}

const DEFAULT_STALL_TIMEOUT_MS = 30_000

class ChecksumMismatchError extends Error {}

/** Reject when a body read outlives its stall window or the attempt deadline. */
async function readWithDeadlines<T>(
  read: Promise<T>,
  stallTimeoutMs: number,
  deadlineAt: number,
  label: string,
): Promise<T> {
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) throw new Error(`${label} download failed: attempt deadline exceeded mid-transfer`)
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(
        remaining <= stallTimeoutMs
          ? `${label} download failed: attempt deadline exceeded mid-transfer`
          : `${label} download stalled: no data for ${Math.round(stallTimeoutMs / 1000)}s — transfer abandoned`,
      ))
    }, Math.min(stallTimeoutMs, remaining))
  })
  try {
    return await Promise.race([read, guard])
  } finally {
    clearTimeout(timer)
  }
}

async function downloadAttempt(url: string, destPath: string, options: DownloadToFileOptions): Promise<DownloadResult> {
  const label = options.label ?? 'Download'
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  const fetchImpl = options.fetchImpl
    ?? (Bun as unknown as { fetch?: typeof fetch }).fetch
    ?? fetch
  const deadlineAt = Date.now() + timeoutMs

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) {
    throw new Error(`${label} download failed: ${res.status} ${res.statusText} (${url})`)
  }
  if (!res.body) {
    throw new Error(`${label} download failed: response carried no body (${url})`)
  }
  const declaredLength = Number(res.headers.get('content-length'))
  const totalBytes = Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : null

  // Manual chunk loop — never `Bun.write(dest, res)`: it ignores the abort
  // signal during body streaming, so a wedged connection hangs forever.
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const sink = createWriteStream(destPath)
  const sinkDone = new Promise<void>((resolve, reject) => {
    sink.once('close', resolve)
    sink.once('error', reject)
  })
  let received = 0
  try {
    for (;;) {
      const chunk = await readWithDeadlines(reader.read(), stallTimeoutMs, deadlineAt, label)
      if (chunk.done) break
      if (!sink.write(chunk.value)) {
        await new Promise<void>((resolve, reject) => {
          sink.once('drain', resolve)
          sink.once('error', reject)
        })
      }
      received += chunk.value.byteLength
      options.onProgress?.(received, totalBytes)
    }
    sink.end()
    await sinkDone
  } catch (err) {
    void reader.cancel().catch(() => { /* already broken */ })
    sink.destroy()
    throw err
  }

  const actual = await sha256File(destPath)
  if (options.sha256 && actual !== options.sha256.toLowerCase()) {
    throw new ChecksumMismatchError(
      `${label} checksum mismatch: expected ${options.sha256.toLowerCase()}, got ${actual} — refusing to install (${url})`,
    )
  }
  return { sha256: actual, bytes: received }
}

/**
 * Stream a URL to `destPath` (parent dirs created), then sha256-verify
 * against the pin. Stall-proof by construction: every body read races the
 * stall window and the attempt deadline, transient failures get fresh-
 * request retries, and any failure deletes the partial file and throws.
 */
export async function downloadToFile(url: string, destPath: string, options: DownloadToFileOptions = {}): Promise<DownloadResult> {
  const label = options.label ?? 'Download'
  const attempts = 1 + Math.max(0, options.retries ?? 1)
  mkdirSync(dirname(destPath), { recursive: true })

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await downloadAttempt(url, destPath, options)
    } catch (err) {
      try { rmSync(destPath, { force: true }) } catch { log.warn(`partial download cleanup failed for ${destPath}`) }
      if (err instanceof ChecksumMismatchError) throw err
      lastError = err
      if (attempt < attempts) {
        log.warn(`${label} download attempt ${attempt}/${attempts} failed — retrying with a fresh request`, {
          url,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  throw lastError
}

export interface ExtractTarMemberOptions {
  timeoutMs?: number
  label?: string
}

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
    await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir, '--', member], {
      timeout: options.timeoutMs ?? EXTRACT_TIMEOUT_MS,
    })
    const memberPath = join(destDir, member)
    if (!existsSync(memberPath)) {
      throw new Error(`member "${member}" not found in archive`)
    }
    return memberPath
  } catch (err) {
    throw new Error(`${label} extraction failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface ExtractTarballOptions {
  /** Leading path components to strip (npm tarballs nest under `package/`). */
  stripComponents?: number
  timeoutMs?: number
  label?: string
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
    mkdirSync(destDir, { recursive: true })
    const args = ['-xzf', archivePath, '-C', destDir]
    if (options.stripComponents) args.push(`--strip-components=${options.stripComponents}`)
    await execFileAsync('tar', args, { timeout: options.timeoutMs ?? EXTRACT_TIMEOUT_MS })
  } catch (err) {
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
