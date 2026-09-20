/**
 * #852 — ledger unavailable ⇒ the overlay FAILS OPEN: no model is ever
 * marked unavailable on missing evidence (opposite of the budget gate's
 * fail-closed, by design — a DB glitch must not starve routing).
 */
import { describe, test, expect, mock, afterAll } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-rej-down-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// The ledger is down — every verb throws, like a locked/corrupt bakin.db.
class FakeLedgerUnavailableError extends Error {}
mock.module('../../../src/core/execution-ledger', () => ({
  LedgerUnavailableError: FakeLedgerUnavailableError,
  listModelRejections: () => { throw new FakeLedgerUnavailableError('ledger op failed: listModelRejections') },
  recordModelRejection: () => { throw new FakeLedgerUnavailableError('ledger op failed: recordModelRejection') },
  resolveModelRejection: () => { throw new FakeLedgerUnavailableError('ledger op failed: resolveModelRejection') },
}))

import {
  fetchAvailableModels,
  setModelsCache,
} from '../../../plugins/models/lib/available-models'
import type { AvailableModel } from '../../../plugins/models/types'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('rejection overlay — ledger down (#852)', () => {
  test('every model stays available; the read never throws', async () => {
    const models: AvailableModel[] = [
      { id: 'openai-codex/gpt-5.4-mini', name: 'x', tier: 'budget', provider: 'openai-codex', available: true },
    ]
    setModelsCache({ models, fetchedAt: Date.now() })

    const result = await fetchAvailableModels({} as never)
    expect(result.models).toHaveLength(1)
    expect(result.models[0]!.available).toBe(true)
    expect(result.models[0]!.rejection).toBeUndefined()
  })
})
