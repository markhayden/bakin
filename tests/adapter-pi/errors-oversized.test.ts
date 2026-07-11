/**
 * T29 — Pi honors MessageArgs.oversizedOutputBytes in session-death
 * diagnoses. Previously hardcoded `oversizedOutput: false`, so the recovery
 * ladder never saw runaway-output deaths on Pi (audit M4 follow-through).
 * Pure unit test: no PI_HOME, no provider — buildStreamDeathError is a pure
 * diagnosis constructor.
 */
import { describe, test, expect, mock, afterAll } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'

// Pure diagnosis-constructor test — the content-dir mocks are blanket
// isolation policy (no code path here touches storage).
const testDir = join(tmpdir(), `bakin-test-pi-oversized-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

import { buildStreamDeathError } from '../../packages/adapter-pi/src/errors'
import { DEFAULT_OVERSIZED_OUTPUT_BYTES } from '../../packages/core/src/adapters/runtime'

describe('pi oversized-output diagnosis (T29)', () => {
  test('completion above the caller threshold marks oversizedOutput true', () => {
    const err = buildStreamDeathError({
      partialText: 'x'.repeat(2_000),
      oversizedOutputBytes: 1_000,
    })
    expect(err.diagnosis.oversizedOutput).toBe(true)
    expect(err.diagnosis.completionBytes).toBe(2_000)
  })

  test('completion below the caller threshold marks oversizedOutput false', () => {
    const err = buildStreamDeathError({
      partialText: 'x'.repeat(500),
      oversizedOutputBytes: 1_000,
    })
    expect(err.diagnosis.oversizedOutput).toBe(false)
  })

  test('absent threshold falls back to the 128 KiB default (OpenClaw parity)', () => {
    expect(DEFAULT_OVERSIZED_OUTPUT_BYTES).toBe(128 * 1024)
    const small = buildStreamDeathError({ partialText: 'tiny' })
    expect(small.diagnosis.oversizedOutput).toBe(false)
    const big = buildStreamDeathError({ partialText: 'y'.repeat(DEFAULT_OVERSIZED_OUTPUT_BYTES + 1) })
    expect(big.diagnosis.oversizedOutput).toBe(true)
  })
})
