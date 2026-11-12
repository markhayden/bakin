/**
 * The onboarding exit rule (spec §1), as a pure function of statuses and
 * typed skip reasons.
 */
import { describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-onboarding-exit-code-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), settings: join(testDir, 'settings.json') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { exitCodeFor } from '../../../src/core/onboarding/index'

const ok = { finalStatus: 'ok' as const }
const warn = { finalStatus: 'warn' as const }
const error = { finalStatus: 'error' as const }
const skipped = (reason: 'not_applicable' | 'declined' | 'requires' | 'check_only' | 'unavailable') => ({ finalStatus: 'skipped' as const, reason })

describe('exitCodeFor', () => {
  test('everything ok is 0', () => {
    expect(exitCodeFor([ok, ok])).toBe(0)
  })

  test('a step that does not apply to the runtime never affects the code', () => {
    expect(exitCodeFor([ok, skipped('not_applicable')])).toBe(0)
    expect(exitCodeFor([warn, skipped('not_applicable')])).toBe(2)
    expect(exitCodeFor([error, skipped('not_applicable')])).toBe(1)
  })

  test.each(['declined', 'check_only', 'unavailable'] as const)('a step skipped as %s leaves the run unfinished: 2', (reason) => {
    expect(exitCodeFor([ok, skipped(reason)])).toBe(2)
  })

  test('a warning is 2', () => {
    expect(exitCodeFor([ok, warn])).toBe(2)
  })

  test('any error is 1, whatever else happened', () => {
    expect(exitCodeFor([ok, warn, skipped('declined'), error])).toBe(1)
  })

  test('a requires skip follows its cause: 1 behind an error, 2 behind a decline', () => {
    // The runtime failed, so everything that needs it was skipped.
    expect(exitCodeFor([error, skipped('requires'), skipped('requires')])).toBe(1)
    // Search was declined, so its models were skipped too: the run is as
    // complete as the operator allowed, not a failure.
    expect(exitCodeFor([ok, skipped('declined'), skipped('requires')])).toBe(2)
  })
})
