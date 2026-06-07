/**
 * Seq watermark migration (SPEC §8 test #8b): legacy per-task dispatch seqs
 * from .dispatch-state.json seed the ledger so freshly minted threadIds can
 * never collide with previously used provider sessions.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-ledger-seq-mig-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { nextSeq, claimNextRun, currentSeq } from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  // Legacy dispatch state present BEFORE the ledger's first open — the v1
  // migration reads it exactly once.
  writeFileSync(
    join(testDir, '.dispatch-state.json'),
    JSON.stringify({
      lastRun: 1748000000000,
      serverStart: 1748000000000,
      dispatched: [],
      failedDispatches: {},
      dispatchSeq: { 'task-legacy': 3, 'task-other': 7, 'task-bogus': 'NaN-ish' },
    }),
    'utf-8',
  )
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('seq watermark migration', () => {
  it('honors legacy seqs — no threadId reuse across the upgrade', () => {
    expect(currentSeq('task-legacy')).toBe(3)
    expect(nextSeq('task-legacy')).toBe(4)

    const claim = claimNextRun({
      taskId: 'task-other',
      agent: 'tester',
      bootId: 'boot-mig',
      runIdFor: (seq) => `task:task-other:d${seq}`,
    })
    expect(claim).toEqual({ claimed: true, runId: 'task:task-other:d8', seq: 8 })
  })

  it('ignores malformed legacy entries and unknown tasks start at 1', () => {
    expect(nextSeq('task-bogus')).toBe(1)
    expect(nextSeq('never-seen')).toBe(1)
  })
})
