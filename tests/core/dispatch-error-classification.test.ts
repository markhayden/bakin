import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-dispatch-classify-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../src/core/watcher', () => ({
  startWatcher: () => {},
  stopWatcher: () => {},
}))

import { RuntimeError, RuntimeTurnError } from '../../packages/core/src/adapters/runtime'
import {
  classifyDispatchError,
  classifyDispatchFailureDetail,
  formatSanitizedRuntimeFailure,
} from '../../src/core/dispatch'
import { openClawRuntimeErrorFromMessage } from '../../packages/adapter-openclaw/src/errors'

describe('classifyDispatchError (kind-based cooldown classification)', () => {
  it('transport → transient (short cooldown)', () => {
    expect(classifyDispatchError(new RuntimeError('OpenClaw chat gateway disconnected', { kind: 'transport' }))).toBe('transient')
    expect(classifyDispatchError(new RuntimeError('socket error', { kind: 'transport' }))).toBe('transient')
  })

  it('timeout / runtime_failed / provider_cooldown / session_death → structural', () => {
    expect(classifyDispatchError(new RuntimeError('request timed out: agent', { kind: 'timeout' }))).toBe('structural')
    expect(classifyDispatchError(new RuntimeError('adapter failure', { kind: 'runtime_failed' }))).toBe('structural')
    expect(classifyDispatchError(new RuntimeError('cooldown', { kind: 'provider_cooldown' }))).toBe('structural')
    expect(classifyDispatchError(new RuntimeTurnError({ reason: 'session_interrupted' }))).toBe('structural')
  })

  it('C1 regression: a transport RuntimeError wrapping ECONNRESET is transient, not structural', () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const err = new RuntimeError('OpenClaw chat gateway disconnected', { kind: 'transport', cause })
    expect(classifyDispatchError(err)).toBe('transient')
  })

  it('non-RuntimeError fallback: TypeError/AbortError/socket cause codes are transient, unknown is structural', () => {
    expect(classifyDispatchError(new TypeError('fetch failed'))).toBe('transient')
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(classifyDispatchError(abort)).toBe('transient')
    const withCause = new Error('send failed')
    ;(withCause as Error & { cause: { code: string } }).cause = { code: 'ECONNREFUSED' }
    expect(classifyDispatchError(withCause)).toBe('transient')
    expect(classifyDispatchError(new Error('totally unknown'))).toBe('structural')
  })
})

describe('classifyDispatchFailureDetail (kind → reasonCode mapping)', () => {
  it('provider_cooldown with providerInfo maps cooldown vs auth-profile reason codes', () => {
    const cooldown = classifyDispatchFailureDetail(new RuntimeError('Provider openai-codex is in cooldown (timeout)', {
      kind: 'provider_cooldown',
      providerInfo: { provider: 'openai-codex', model: 'openai-codex/gpt-5.5', cooldownReason: 'timeout' },
    }))
    expect(cooldown.reasonCode).toBe('provider_cooldown')
    expect(cooldown.category).toBe('model_provider_unavailable')
    expect(cooldown.provider).toBe('openai-codex')
    expect(cooldown.model).toBe('openai-codex/gpt-5.5')
    expect(cooldown.cooldownReason).toBe('timeout')

    const auth = classifyDispatchFailureDetail(new RuntimeError('No available auth profile for openai-codex', {
      kind: 'provider_cooldown',
      providerInfo: { provider: 'openai-codex', authProfileUnavailable: true },
    }))
    expect(auth.reasonCode).toBe('auth_profile_unavailable')
    expect(auth.specificReason).toBe('Auth profile unavailable')
  })

  it('timeout → dispatch_timeout, transport → transport_failure, runtime_failed → runtime_adapter_failure', () => {
    expect(classifyDispatchFailureDetail(new RuntimeError('x', { kind: 'timeout' })).reasonCode).toBe('dispatch_timeout')
    expect(classifyDispatchFailureDetail(new RuntimeError('x', { kind: 'transport' })).reasonCode).toBe('transport_failure')
    expect(classifyDispatchFailureDetail(new RuntimeError('x', { kind: 'runtime_failed' })).reasonCode).toBe('runtime_adapter_failure')
  })

  it('session_death → runtime_turn_died, not retryable, carries the diagnosis detail', () => {
    const detail = classifyDispatchFailureDetail(new RuntimeTurnError({
      reason: 'session_interrupted',
      completionBytes: 708567,
      detail: 'OpenClaw session interrupted after oversized model completion (708KB)',
    }))
    expect(detail.reasonCode).toBe('runtime_turn_died')
    expect(detail.retryable).toBe(false)
    expect(detail.specificReason).toContain('oversized model completion')
  })

  it('unknown errors fall back to runtime_dispatch_failed', () => {
    expect(classifyDispatchFailureDetail(new Error('mystery')).reasonCode).toBe('runtime_dispatch_failed')
  })
})

describe('formatSanitizedRuntimeFailure', () => {
  it('uses kinds and diagnosis details, never raw provider text', () => {
    expect(formatSanitizedRuntimeFailure(new RuntimeError('OpenClaw chat gateway request timed out: agent', { kind: 'timeout' })))
      .toBe('runtime gateway request timed out')
    expect(formatSanitizedRuntimeFailure(new RuntimeError('socket exploded with secrets', { kind: 'transport' })))
      .toBe('runtime transport failure')
    expect(formatSanitizedRuntimeFailure(new RuntimeTurnError({
      reason: 'runtime_timeout',
      detail: 'codex app-server idle timeout waiting for turn completion',
    }))).toBe('codex app-server idle timeout waiting for turn completion')
  })
})

describe('adapter: openClawRuntimeErrorFromMessage (the ONE provider-string interpreter)', () => {
  it('maps idle-timeout strings to RuntimeTurnError(runtime_timeout)', () => {
    for (const msg of [
      'codex app-server turn idle timed out waiting for turn/completed',
      'turn_completion_idle_timeout; code=UNAVAILABLE',
    ]) {
      const err = openClawRuntimeErrorFromMessage(msg)
      expect(err).toBeInstanceOf(RuntimeTurnError)
      expect((err as RuntimeTurnError).diagnosis.reason).toBe('runtime_timeout')
    }
  })

  it('maps cooldown/auth strings to provider_cooldown with extracted providerInfo', () => {
    const cooldown = openClawRuntimeErrorFromMessage(
      'FallbackSummaryError: All models failed (1): openai-codex/gpt-5.5: Provider openai-codex is in cooldown (suspending lanes) (timeout); code=UNAVAILABLE',
    )
    expect(cooldown.kind).toBe('provider_cooldown')
    expect(cooldown.providerInfo?.provider).toBe('openai-codex')
    expect(cooldown.providerInfo?.model).toBe('openai-codex/gpt-5.5')
    expect(cooldown.providerInfo?.cooldownReason).toBe('timeout')

    const auth = openClawRuntimeErrorFromMessage(
      'Error: No available auth profile for openai-codex (all in cooldown or unavailable).; code=UNAVAILABLE',
    )
    expect(auth.kind).toBe('provider_cooldown')
    expect(auth.providerInfo?.authProfileUnavailable).toBe(true)
    expect(auth.providerInfo?.provider).toBe('openai-codex')
  })

  it('defaults to runtime_failed with the message preserved', () => {
    const err = openClawRuntimeErrorFromMessage('agent exploded; code=INTERNAL')
    expect(err.kind).toBe('runtime_failed')
    expect(err.message).toContain('agent exploded')
  })
})

describe('architecture: dispatch.ts never classifies on error-message text', () => {
  it('contains no substring/regex matching against error messages', () => {
    const source = readFileSync(join(import.meta.dir, '../../src/core/dispatch.ts'), 'utf-8')
    // The historical substring-classification patterns — none may return.
    // (Human-readable output labels like 'Provider in cooldown after timeout'
    // are fine; INSPECTING error text to decide behavior is not.)
    expect(source).not.toContain('lower.includes(')
    expect(source).not.toContain('message.includes(')
    expect(source).not.toContain('raw.includes(')
    expect(source).not.toContain('rawError.includes(')
    expect(source).not.toContain('.toLowerCase()')
    expect(source).not.toMatch(/\.match\(\s*\/\\bfailed/) // the HTTP-status regex probe
    expect(source).not.toContain('turn_completion_idle_timeout')
    expect(source).not.toContain('extractProviderFromRuntimeError')
    expect(source).not.toContain('extractModelFromRuntimeError')
  })
})
