/**
 * OpenClaw CLI wrapper — the only place in the memory plugin that shells
 * out to the `openclaw` binary.
 *
 * Scope: surfaces that have no gateway RPC equivalent, specifically
 *   - `openclaw memory status --json`
 *   - `openclaw memory search --json --query <q>`
 *
 * Everything else (sessions, agents, usage) goes through
 * `openclaw-gateway.ts`. Uses execFile, never shell exec.
 */
import { execFile as nodeExecFile } from 'child_process'
import { createLogger } from '../../../src/core/logger'
import { getSettings } from '../../../src/core/settings'

const log = createLogger('memory:cli')

// ─── Error type ──────────────────────────────────────────────────────────────

export class MemoryCliError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly stderr?: string,
  ) {
    super(message)
    this.name = 'MemoryCliError'
  }
}

// ─── execFile injection (for tests) ──────────────────────────────────────────
//
// Production code uses node's real execFile via promisify. Tests don't need
// to override this because vi.mock('child_process') already intercepts. The
// setter exists so a suite that does manual injection (no vi.mock) can swap
// in a fake — we don't currently use it, but it keeps the door open.

type ExecFileFn = (
  cmd: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>

let injectedExec: ExecFileFn | null = null

export function __setOpenclawCliExecFileForTests(fn: ExecFileFn | null): void {
  injectedExec = fn
}

function execFilePromise(): ExecFileFn {
  if (injectedExec) return injectedExec
  return (cmd, args, options) =>
    new Promise((resolve, reject) => {
      nodeExecFile(cmd, args, options, (err, stdout, stderr) => {
        if (err) {
          const e = err as Error & { stderr?: string }
          e.stderr = String(stderr ?? '')
          reject(e)
          return
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      })
    })
}

// ─── Shared runner ───────────────────────────────────────────────────────────

interface RunOptions {
  timeoutMs?: number
  maxBuffer?: number
}

async function run(args: string[], opts: RunOptions = {}): Promise<string> {
  const settings = getSettings()
  const cmd = settings.openclaw.binaryPath
  const timeout = opts.timeoutMs ?? 15_000
  const maxBuffer = opts.maxBuffer ?? 10 * 1024 * 1024

  try {
    const { stdout } = await execFilePromise()(cmd, args, { timeout, maxBuffer })
    return stdout
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('openclaw CLI failed', { args: args.join(' '), err: msg, stderr })
    throw new MemoryCliError(`openclaw ${args.join(' ')} failed: ${msg}`, err, stderr)
  }
}

function parseJson<T>(raw: string, args: string[]): T {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    // Special-cased by callers; we still bubble empty up.
    return undefined as unknown as T
  }
  try {
    return JSON.parse(trimmed) as T
  } catch (err) {
    throw new MemoryCliError(
      `openclaw ${args.join(' ')} returned non-JSON output`,
      err,
    )
  }
}

// ─── memoryStatus ────────────────────────────────────────────────────────────

export interface MemoryStatusResult {
  ready?: boolean
  docs?: number
  [key: string]: unknown
}

export async function memoryStatus(opts: RunOptions = {}): Promise<MemoryStatusResult> {
  const args = ['memory', 'status', '--json']
  const stdout = await run(args, opts)
  const parsed = parseJson<MemoryStatusResult>(stdout, args)
  if (parsed === undefined) {
    throw new MemoryCliError(`openclaw ${args.join(' ')} returned empty output`)
  }
  return parsed
}

// ─── memorySearch ────────────────────────────────────────────────────────────

export interface MemorySearchHit {
  path?: string
  score?: number
  snippet?: string
  [key: string]: unknown
}

export interface MemorySearchResult {
  results: MemorySearchHit[]
  [key: string]: unknown
}

export interface MemorySearchOptions extends RunOptions {
  agent?: string
  limit?: number
}

export async function memorySearch(
  query: string,
  opts: MemorySearchOptions = {}
): Promise<MemorySearchResult> {
  if (!query || query.trim().length === 0) {
    throw new MemoryCliError('memorySearch requires a non-empty query')
  }
  const args = ['memory', 'search', '--query', query, '--json']
  if (opts.agent) args.push('--agent', opts.agent)
  if (typeof opts.limit === 'number') args.push('--limit', String(opts.limit))

  const stdout = await run(args, opts)
  const parsed = parseJson<MemorySearchResult>(stdout, args)
  if (parsed === undefined) return { results: [] }
  if (!parsed.results) parsed.results = []
  return parsed
}
