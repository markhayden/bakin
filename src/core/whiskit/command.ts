/**
 * Stable system-`bun` runner for the Whiskit build backend (Phase 2).
 *
 * Why a subprocess at all: the compiled `bakin` binary cannot rely on its
 * embedded Bun for plugin builds (in-process `Bun.build()` resolves against
 * the `/$bunfs/` virtual filesystem, not the user's machine), so every
 * publish/install build shells out to the system `bun` found on PATH. The
 * same runner is used from a source checkout so CI and dev machines take
 * one code path.
 *
 * Hardening:
 *   - argv-array spawn — no shell, no interpolation
 *   - env allowlist — plugin builds (and their postinstall-adjacent tooling)
 *     never see Bakin's secrets; only what `bun` needs to resolve + cache
 *   - wall-clock timeout with SIGKILL — a hung build can't wedge the server
 *   - capped stdout/stderr capture — a log-spamming build can't balloon memory
 */
import { spawn } from 'node:child_process'
import { WhiskitBuildError, type WhiskitCommandResult } from './types'

export const DEFAULT_BUILD_TIMEOUT_MS = 120_000

/** Cap captured stdout/stderr at 256 KB each — plenty for any real error. */
const OUTPUT_CAP_BYTES = 256 * 1024

/**
 * Environment variables a plugin build legitimately needs. Everything else
 * (API keys, tokens, Bakin internals) is withheld.
 */
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'USER',
  'LANG',
  'LC_ALL',
  'BUN_INSTALL',
  'BUN_INSTALL_CACHE_DIR',
  'NPM_CONFIG_REGISTRY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'SystemRoot', // Windows: child processes fail to start without it
] as const

/**
 * Locate the system `bun` executable. `BAKIN_BUN_PATH` overrides for odd
 * setups (CI containers, hermetic builds); otherwise PATH lookup.
 */
export function findSystemBun(): string {
  const override = process.env.BAKIN_BUN_PATH
  if (override && override.trim().length > 0) return override
  const found = Bun.which('bun')
  if (!found) {
    throw new WhiskitBuildError(
      'resolve-bun',
      'System `bun` not found on PATH. Plugin builds require Bun (https://bun.sh) — install it or set BAKIN_BUN_PATH.',
    )
  }
  return found
}

function allowlistedEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { NO_COLOR: '1' }
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return { ...env, ...extraEnv }
}

export interface RunSystemBunOptions {
  cwd: string
  /** Wall-clock limit; the process is SIGKILLed past it. */
  timeoutMs?: number
  /** Extra env vars layered over the allowlist (e.g. NODE_ENV). */
  extraEnv?: Record<string, string>
}

class CappedCollector {
  private chunks: Buffer[] = []
  private size = 0
  truncated = false

  push(chunk: Buffer): void {
    if (this.size >= OUTPUT_CAP_BYTES) {
      this.truncated = true
      return
    }
    const room = OUTPUT_CAP_BYTES - this.size
    const piece = chunk.byteLength > room ? chunk.subarray(0, room) : chunk
    if (piece.byteLength < chunk.byteLength) this.truncated = true
    this.chunks.push(piece)
    this.size += piece.byteLength
  }

  toString(): string {
    const text = Buffer.concat(this.chunks).toString('utf-8')
    return this.truncated ? `${text}\n… [output truncated]` : text
  }
}

/**
 * Run `bun <args>` with the hardened settings above. Resolves with the
 * captured result for any exit (including non-zero and timeout) — callers
 * decide what a failure means for their stage. Rejects only when the
 * process cannot be spawned at all.
 */
export function runSystemBun(args: string[], options: RunSystemBunOptions): Promise<WhiskitCommandResult> {
  const bun = findSystemBun()
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const proc = spawn(bun, args, {
      cwd: options.cwd,
      env: allowlistedEnv(options.extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdout = new CappedCollector()
    const stderr = new CappedCollector()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGKILL')
    }, timeoutMs)

    proc.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    proc.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    proc.once('error', (err) => {
      clearTimeout(timer)
      reject(new WhiskitBuildError('resolve-bun', `Failed to spawn ${bun}: ${err.message}`))
    })
    proc.once('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({
        exitCode: code ?? (timedOut ? 124 : 0),
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        timedOut,
        durationMs: Date.now() - startedAt,
      })
    })
  })
}

/**
 * Shape a failed command into a WhiskitBuildError with a readable, bounded
 * message: stage + exit reason + the stderr tail (where bun puts its
 * diagnostics). Never embeds the full environment or argv.
 */
export function commandFailure(
  stage: WhiskitBuildError['stage'],
  what: string,
  result: WhiskitCommandResult,
): WhiskitBuildError {
  const reason = result.timedOut
    ? `timed out after ${Math.round(result.durationMs / 1000)}s`
    : `exited with code ${result.exitCode}`
  const tail = result.stderr.trim().split('\n').slice(-25).join('\n')
  return new WhiskitBuildError(
    stage,
    `${what} ${reason}${tail ? `:\n${tail}` : ''}`,
    result.stderr,
  )
}
