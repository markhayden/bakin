/**
 * The ONE place OpenClaw provider error strings are interpreted.
 *
 * Gateway responses and CLI failures arrive as free text; this module maps
 * them to typed `RuntimeError` kinds before they cross the adapter boundary.
 * Core (dispatch) classifies on `kind`/`providerInfo` exclusively — if a
 * provider wording changes, this file is the only thing that needs to know.
 */
import { RuntimeError, RuntimeTurnError, type RuntimeProviderInfo } from '@bakin/core/adapters/runtime'

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
