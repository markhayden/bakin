/**
 * #852 — model_rejections ledger table: the durable "this account cannot
 * call model X" evidence record. One row per model (UNIQUE(model) is the
 * debounce, mirroring budget_incidents), reopen-on-conflict, self-healing
 * resolve on later success.
 */
import { describe, test, expect, mock, afterAll } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-model-rejections-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { closeDb } from '../../packages/core/src/storage/db'
import {
  recordModelRejection,
  resolveModelRejection,
  listModelRejections,
} from '../../src/core/execution-ledger'

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

const MODEL = 'openai-codex/gpt-5.4-mini'

describe('model_rejections ledger (#852)', () => {
  test('first rejection opens a row; repeats debounce onto it with occurrences++ and a fresh last_seen', () => {
    const first = recordModelRejection({ model: MODEL, provider: 'openai-codex', detail: 'not supported with ChatGPT account', at: 1_000 })
    expect(first.opened).toBe(true)

    const repeat = recordModelRejection({ model: MODEL, provider: 'openai-codex', detail: 'still not supported', at: 2_000 })
    expect(repeat.opened).toBe(false)
    expect(repeat.id).toBe(first.id)

    const rows = listModelRejections({ openOnly: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.model).toBe(MODEL)
    expect(rows[0]!.occurrences).toBe(2)
    expect(rows[0]!.firstSeenAt).toBe(1_000)
    expect(rows[0]!.lastSeenAt).toBe(2_000)
    expect(rows[0]!.status).toBe('open')
  })

  test('resolve on success clears the row; openOnly listings drop it, full listings keep the history', () => {
    expect(resolveModelRejection({ model: MODEL, resolution: 'model_succeeded', resolvedAt: 3_000 })).toBe(true)
    // Resolving an already-resolved model is a no-op, not an error.
    expect(resolveModelRejection({ model: MODEL, resolution: 'model_succeeded' })).toBe(false)

    expect(listModelRejections({ openOnly: true })).toHaveLength(0)
    const all = listModelRejections()
    expect(all).toHaveLength(1)
    expect(all[0]!.status).toBe('resolved')
    expect(all[0]!.resolution).toBe('model_succeeded')
    expect(all[0]!.resolvedAt).toBe(3_000)
  })

  test('a rejection after resolve REOPENS the same row (new alertable event) without losing lifetime occurrences', () => {
    const reopened = recordModelRejection({ model: MODEL, at: 4_000 })
    expect(reopened.opened).toBe(true)

    const rows = listModelRejections({ openOnly: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.occurrences).toBe(3)
    expect(rows[0]!.lastSeenAt).toBe(4_000)
    expect(rows[0]!.resolvedAt).toBeNull()
    expect(rows[0]!.resolution).toBeNull()
  })

  test('detail is bounded — a runaway provider body cannot balloon the ledger', () => {
    recordModelRejection({ model: 'p/other', detail: 'x'.repeat(10_000), at: 5_000 })
    const row = listModelRejections({ openOnly: true }).find((r) => r.model === 'p/other')
    expect(row).toBeDefined()
    expect(row!.detail!.length).toBeLessThanOrEqual(500)
  })

  test('resolving an unknown model is false, never a throw', () => {
    expect(resolveModelRejection({ model: 'p/never-seen', resolution: 'probe_succeeded' })).toBe(false)
  })
})
