import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-runtime-errors-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))

import {
  RuntimeError,
  RuntimeTurnError,
  type RuntimeErrorKind,
  type RuntimeTurnDiagnosis,
} from '../../packages/core/src/adapters/runtime'
import { DEFAULT_SETTINGS } from '../../packages/core/src/settings'

describe('RuntimeError contracts', () => {
  it('carries kind and preserves cause', () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const err = new RuntimeError('socket dropped', { kind: 'transport', cause })

    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(RuntimeError)
    expect(err.kind).toBe('transport')
    expect(err.cause).toBe(cause)
    expect(err.message).toBe('socket dropped')
  })

  it('supports every declared kind', () => {
    const kinds: RuntimeErrorKind[] = [
      'transport',
      'timeout',
      'session_death',
      'provider_cooldown',
      'runtime_failed',
    ]
    for (const kind of kinds) {
      expect(new RuntimeError('x', { kind }).kind).toBe(kind)
    }
  })

  it('RuntimeTurnError is a session_death RuntimeError carrying a diagnosis', () => {
    const diagnosis: RuntimeTurnDiagnosis = {
      reason: 'session_interrupted',
      sessionId: '69435183-055a-457c-a3ff-379b5cf0d929',
      sessionStatus: 'interrupted',
      timedOut: false,
      completionBytes: 708567,
      outputTruncated: true,
      oversizedOutput: true,
      lastToolCall: 'bakin_exec_tasks_log_progress',
      detail: 'OpenClaw session interrupted after oversized model completion (708KB)',
    }
    const err = new RuntimeTurnError(diagnosis)

    expect(err).toBeInstanceOf(RuntimeError)
    expect(err.kind).toBe('session_death')
    expect(err.diagnosis).toEqual(diagnosis)
    expect(err.message).toContain('oversized model completion')
  })

  it('RuntimeTurnError falls back to a generic message when detail is absent', () => {
    const err = new RuntimeTurnError({ reason: 'runtime_timeout' })
    expect(err.message.length).toBeGreaterThan(0)
    expect(err.diagnosis.reason).toBe('runtime_timeout')
  })
})

describe('dispatch settings defaults', () => {
  it('declares oversized-output and concurrency defaults', () => {
    expect(DEFAULT_SETTINGS.dispatch.oversizedOutputBytes).toBe(131072)
    expect(DEFAULT_SETTINGS.dispatch.maxConcurrentTurns).toBe(3)
    // 2 since same-agent-concurrency shipped: isolated runtimes (Pi) run two
    // turns per agent in per-run dirs; serialized runtimes clamp to 1.
    expect(DEFAULT_SETTINGS.dispatch.maxTurnsPerAgent).toBe(2)
    expect(DEFAULT_SETTINGS.dispatch.runDirRetentionDays).toBe(7)
    expect(DEFAULT_SETTINGS.dispatch.runDirMaxTotalGb).toBe(4)
  })
})
