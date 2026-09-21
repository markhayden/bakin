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
import { createReadStream, chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
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
  /** Wall-clock abort for the whole download. Default 120s. */
  timeoutMs?: number
  /**
   * Fetch implementation. Defaults to Bun's NATIVE fetch — the test
   * preload's happy-dom fetch cannot drive real sockets (CLAUDE.md).
   */
  fetchImpl?: typeof fetch
  /** Human prefix for error messages, e.g. `Binary "ripgrep"`. */
  label?: string
}

export interface DownloadResult {
  /** sha256 of the downloaded bytes (== the pin when one was given). */
  sha256: string
  bytes: number
}

/**
 * Stream a URL to `destPath` (parent dirs created), then sha256-verify
 * against the pin. Any failure deletes the partial file and throws.
 */
export async function downloadToFile(url: string, destPath: string, options: DownloadToFileOptions = {}): Promise<DownloadResult> {
  const label = options.label ?? 'Download'
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS
  const fetchImpl = options.fetchImpl
    ?? (Bun as unknown as { fetch?: typeof fetch }).fetch
    ?? fetch

  mkdirSync(dirname(destPath), { recursive: true })
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) {
      throw new Error(`${label} download failed: ${res.status} ${res.statusText} (${url})`)
    }
    // Streams — never buffers the file in memory. The repo's hand-rolled Bun
    // namespace types don't declare the Response overload; runtime supports it.
    const bytes = await (Bun.write as unknown as (dest: string, input: Response) => Promise<number>)(destPath, res)

    const actual = await sha256File(destPath)
    if (options.sha256 && actual !== options.sha256.toLowerCase()) {
      throw new Error(
        `${label} checksum mismatch: expected ${options.sha256.toLowerCase()}, got ${actual} — refusing to install (${url})`,
      )
    }
    return { sha256: actual, bytes }
  } catch (err) {
    try { rmSync(destPath, { force: true }) } catch { log.warn(`partial download cleanup failed for ${destPath}`) }
    throw err
  }
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
