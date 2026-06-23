/**
 * The ONE place OpenClaw provider error strings are interpreted.
 *
 * Gateway responses and CLI failures arrive as free text; this module maps
 * them to typed `RuntimeError` kinds before they cross the adapter boundary.
 * Core (dispatch) classifies on `kind`/`providerInfo` exclusively — if a
 * provider wording changes, this file is the only thing that needs to know.
 */
import { RuntimeError, RuntimeTurnError, type RuntimeProviderInfo } from '@bakin/core/adapters/runtime'
import { stripAnsi } from './runtime-utils'

/** codex app-server ended the run before the turn reported completion. */
const IDLE_TIMEOUT_PATTERNS = [
  'turn_completion_idle_timeout',
  'idle timed out waiting for turn/completed',
]

const COOLDOWN_PATTERNS = [
  'no available auth profile',
  'suspending lanes',
]
const PROVIDER_COOLDOWN_RE = /\bprovider\b.*\bin cooldown\b/i

export function extractOpenClawProviderInfo(message: string): RuntimeProviderInfo {
  const provider = message.match(/No available auth profile for\s+([A-Za-z0-9._/-]+)/i)?.[1]
    ?? message.match(/Provider\s+([A-Za-z0-9._/-]+)\s+is in cooldown/i)?.[1]
  const model = message.match(/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+):\s+Provider\s+/i)?.[1]
  const lower = message.toLowerCase()
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(lower.includes('timeout') ? { cooldownReason: 'timeout' } : {}),
    ...(lower.includes('no available auth profile') ? { authProfileUnavailable: true } : {}),
  }
}

/**
 * Map a failed gateway/agent response message to a typed runtime error.
 * Used for provider-originated failures (response frames, chat errors) —
 * transport/timeout failures are constructed directly at their source with
 * the right kind and never pass through string interpretation.
 */
export function openClawRuntimeErrorFromMessage(message: string, cause?: unknown): RuntimeError {
  const lower = message.toLowerCase()

  if (IDLE_TIMEOUT_PATTERNS.some((p) => lower.includes(p))) {
    return new RuntimeTurnError({
      reason: 'runtime_timeout',
      timedOut: true,
      detail: 'codex app-server idle timeout waiting for turn completion',
    }, { cause: cause ?? new Error(message) })
  }

  if (COOLDOWN_PATTERNS.some((p) => lower.includes(p)) || PROVIDER_COOLDOWN_RE.test(message)) {
    return new RuntimeError(message, {
      kind: 'provider_cooldown',
      cause,
      providerInfo: extractOpenClawProviderInfo(message),
    })
  }

  return new RuntimeError(message, { kind: 'runtime_failed', cause })
}


// ─── CLI command failures ──────────────────────────────────────────────────
// OpenClaw CLI invocations surface as child_process errors; this captures the
// stdout/stderr/exit-code so callers can classify (e.g. the open-allowlist
// warning) without re-parsing free text at every call site.

const OPENCLAW_PLUGIN_ALLOWLIST_WARNING = 'plugins.allow is empty'

export class OpenClawCommandError extends RuntimeError {
  readonly args: string[]
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | string | undefined

  constructor(args: string[], cause: unknown) {
    const stdout = processOutput(cause, 'stdout')
    const stderr = processOutput(cause, 'stderr')
    const exitCode = processExitCode(cause)
    const details = [stderr, stdout].filter((part) => part.trim().length > 0).join('\n')
    super([
      `OpenClaw command failed${exitCode === undefined ? '' : ` (${exitCode})`}: openclaw ${args.join(' ')}`,
      details,
    ].filter(Boolean).join('\n'), { kind: 'runtime_failed', cause })
    this.name = 'OpenClawCommandError'
    this.args = args
    this.stdout = stdout
    this.stderr = stderr
    this.exitCode = exitCode
  }
}

function processOutput(cause: unknown, field: 'stdout' | 'stderr'): string {
  if (!cause || typeof cause !== 'object') return ''
  const value = (cause as Record<string, unknown>)[field]
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf-8')
  return ''
}

function processExitCode(cause: unknown): number | string | undefined {
  if (!cause || typeof cause !== 'object') return undefined
  const value = (cause as Record<string, unknown>).code
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}

function openClawErrorOutput(err: unknown): string {
  if (err instanceof OpenClawCommandError) {
    return [err.stderr, err.stdout, err.message].filter(Boolean).join('\n')
  }
  if (!err || typeof err !== 'object') return String(err ?? '')
  const record = err as Record<string, unknown>
  return [
    typeof record.stderr === 'string' ? record.stderr : '',
    typeof record.stdout === 'string' ? record.stdout : '',
    typeof record.message === 'string' ? record.message : '',
  ].filter(Boolean).join('\n')
}

export function isPluginAllowlistOpenFailure(err: unknown): boolean {
  if (err instanceof OpenClawCommandError) {
    const stderr = stripAnsi(err.stderr).trim()
    const stdout = stripAnsi(err.stdout).trim()
    const nonWarningStderr = stderr
      .split('\n')
      .filter((line) => !line.includes(OPENCLAW_PLUGIN_ALLOWLIST_WARNING))
      .join('\n')
      .trim()
    return stdout.length === 0 && stderr.includes(OPENCLAW_PLUGIN_ALLOWLIST_WARNING) && nonWarningStderr.length === 0
  }
  return stripAnsi(openClawErrorOutput(err)).includes(OPENCLAW_PLUGIN_ALLOWLIST_WARNING)
}
