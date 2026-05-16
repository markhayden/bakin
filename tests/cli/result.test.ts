import { describe, expect, it } from 'bun:test'

import { errorResult, okResult, serializeEnvelope, toEnvelope } from '../../src/core/cli/result'

describe('CLI result envelope', () => {
  it('wraps successful command data in a stable envelope', () => {
    expect(toEnvelope(okResult('status', { running: true }))).toEqual({
      ok: true,
      command: 'status',
      exitCode: 0,
      data: { running: true },
      error: null,
    })
  })

  it('treats warning exit code 2 as ok when no error is present', () => {
    expect(toEnvelope(okResult('onboard', { warnings: 1 }, 2))).toEqual({
      ok: true,
      command: 'onboard',
      exitCode: 2,
      data: { warnings: 1 },
      error: null,
    })
  })

  it('wraps failures with stable error shape', () => {
    expect(toEnvelope(errorResult('onboard', 'RUNTIME_BLOCKED', 'Runtime is required'))).toEqual({
      ok: false,
      command: 'onboard',
      exitCode: 1,
      data: {},
      error: {
        code: 'RUNTIME_BLOCKED',
        message: 'Runtime is required',
      },
    })
  })

  it('serializes envelopes with a trailing newline', () => {
    expect(serializeEnvelope(okResult('version', { version: '1.2.3' }))).toBe(
      '{\n  "ok": true,\n  "command": "version",\n  "exitCode": 0,\n  "data": {\n    "version": "1.2.3"\n  },\n  "error": null\n}\n',
    )
  })
})
