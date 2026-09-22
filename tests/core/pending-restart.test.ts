/**
 * Pending-restart state (#878, D30, S16): adapter advice decides whether a
 * change kind needs a restart; only a successful restart clears the record;
 * a failed attempt keeps it and is shown; Pi never records anything; an
 * adapter without restartAdvice() gets the generic advice.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-pending-restart-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

import { mockRestartAdvice } from '../../packages/core/src/adapters/runtime/testing'
import { clearPendingRestart, describeRestart, GENERIC_RESTART_ADVICE, notePendingChange, recordRestartFailure } from '../../src/core/pending-restart'

const pi = { restartAdvice: mockRestartAdvice({ needed: false }) }
const openclaw = {
  restartAdvice: mockRestartAdvice({
    'model-config': { needed: false },
    'routing-policy': { needed: false },
    roster: { needed: true, title: 'Restart the OpenClaw gateway', body: 'Agents attach at gateway start.', action: { label: 'Restart gateway', kind: 'restart-runtime' } },
  }),
}
const legacy = {} // no restartAdvice member

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => clearPendingRestart())

describe('pending restart (S16)', () => {
  it('Pi: a model save records nothing — no banner, ever', () => {
    notePendingChange(pi, ['model-config', 'roster', 'routing-policy'])
    expect(describeRestart(pi)).toMatchObject({ pending: false, kinds: [] })
    expect(existsSync(join(testDir, 'plugin-settings', 'models', 'pending-restart.json'))).toBe(false)
  })

  it('OpenClaw: a model save is live; a roster change pends with the ADAPTER\'s words; success clears; failure retains + shows', () => {
    notePendingChange(openclaw, ['model-config'])
    expect(describeRestart(openclaw).pending).toBe(false)

    notePendingChange(openclaw, ['roster'])
    const pending = describeRestart(openclaw)
    expect(pending).toMatchObject({ pending: true, kinds: ['roster'], generic: false })
    expect(pending.advice).toMatchObject({ title: 'Restart the OpenClaw gateway', action: { label: 'Restart gateway', kind: 'restart-runtime' } })

    recordRestartFailure(new Error('gateway restart timed out'))
    const failed = describeRestart(openclaw)
    expect(failed.pending).toBe(true)
    expect(failed.lastAttempt).toMatchObject({ ok: false, error: 'gateway restart timed out' })

    clearPendingRestart()
    expect(describeRestart(openclaw).pending).toBe(false)
  })

  it('an adapter without restartAdvice() gets the generic advice and records conservatively', () => {
    notePendingChange(legacy, ['model-config'])
    const status = describeRestart(legacy)
    expect(status).toMatchObject({ pending: true, generic: true })
    expect(status.advice).toEqual(GENERIC_RESTART_ADVICE)
  })

  it('kinds accumulate without duplicates and keep the original since', () => {
    notePendingChange(legacy, ['model-config'])
    const first = describeRestart(legacy).since
    notePendingChange(legacy, ['model-config', 'roster'])
    const status = describeRestart(legacy)
    expect(status.kinds.sort()).toEqual(['model-config', 'roster'])
    expect(status.since).toBe(first)
  })
})
