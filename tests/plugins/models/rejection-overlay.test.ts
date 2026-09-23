/**
 * #852 — the account-rejection availability overlay. Open model_rejections
 * rows flip `available: false` (+ typed rejection info) on EVERY read,
 * including cache-served reads — the withFreshTiers posture: ledger state is
 * never pinned by the cache, in either direction. The cache itself stays a
 * dumb runtime snapshot (overlay never persisted).
 */
import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-rej-overlay-${Date.now()}-${randomUUID()}`)
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

import type { PluginContext } from '@bakin/core/plugin-types'
import { closeDb } from '../../../packages/core/src/storage/db'
import { recordModelRejection, resolveModelRejection } from '../../../src/core/execution-ledger'
import {
  fetchAvailableModels,
  setModelsCache,
} from '../../../plugins/models/lib/available-models'
import { readPersistedCache, clearPersistedCache } from '../../../plugins/models/lib/models-cache'
import { buildPlanInput } from '../../../plugins/models/lib/plan'
import type { AvailableModel } from '../../../plugins/models/types'

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

const DEAD = 'openai-codex/gpt-5.4-mini'
const LIVE = 'openai-codex/gpt-5.6-luna'

const runtimeRows = [
  { id: DEAD, name: 'gpt-5.4-mini', available: true },
  { id: LIVE, name: 'gpt-5.6-luna', available: true },
]

const fakeCtx = {
  runtime: {
    models: {
      listAvailable: async () => runtimeRows,
      routingPolicy: async () => ({ defaultModel: LIVE, fallbackModels: [] }),
    },
  },
} as unknown as PluginContext

function cachedFixture(): AvailableModel[] {
  return [
    { id: DEAD, name: 'gpt-5.4-mini', tier: 'budget', provider: 'openai-codex', available: true },
    { id: LIVE, name: 'gpt-5.6-luna', tier: 'premium', provider: 'openai-codex', available: true },
  ]
}

beforeEach(() => {
  setModelsCache(null)
  clearPersistedCache()
  // Clean slate: resolve anything a prior test left open.
  resolveModelRejection({ model: DEAD, resolution: 'manual' })
  resolveModelRejection({ model: LIVE, resolution: 'manual' })
})

describe('rejection overlay (#852)', () => {
  test('a rejection recorded AFTER the cache was written is reflected on the next cache-served read', async () => {
    setModelsCache({ models: cachedFixture(), fetchedAt: Date.now() })

    recordModelRejection({ model: DEAD, provider: 'openai-codex' })
    const result = await fetchAvailableModels(fakeCtx)

    expect(result.cached).toBe(true)
    const dead = result.models.find((m) => m.id === DEAD)!
    expect(dead.available).toBe(false)
    expect(dead.rejection?.occurrences).toBe(1)
    expect(dead.rejection?.lastSeenAt).toBeGreaterThan(0)
    // Flip, not filter: the row is still present, and healthy rows untouched.
    expect(result.models.find((m) => m.id === LIVE)!.available).toBe(true)
  })

  test('resolve restores availability on the very next read — no refresh needed', async () => {
    setModelsCache({ models: cachedFixture(), fetchedAt: Date.now() })
    recordModelRejection({ model: DEAD })
    expect((await fetchAvailableModels(fakeCtx)).models.find((m) => m.id === DEAD)!.available).toBe(false)

    resolveModelRejection({ model: DEAD, resolution: 'model_succeeded' })
    const after = await fetchAvailableModels(fakeCtx)
    expect(after.models.find((m) => m.id === DEAD)!.available).toBe(true)
    expect(after.models.find((m) => m.id === DEAD)!.rejection).toBeUndefined()
  })

  test('END-TO-END: a recorded rejection vanishes from the recommender pool (the post-#854 skill-mapping regression)', async () => {
    // The chain the incident rode: cache → eligibility overlay → plan
    // candidates. DEAD is budget-tier, so without rejection evidence it is
    // the chores pick.
    setModelsCache({ models: cachedFixture(), fetchedAt: Date.now() })
    const planCtx = {
      ...fakeCtx,
      getSettings: <T,>() => ({}) as T,
      hooks: { has: () => false, invoke: async () => { throw new Error('no hooks') } },
    } as unknown as PluginContext

    const before = await buildPlanInput(planCtx)
    expect(before.candidates.some((c) => c.id === DEAD)).toBe(true)

    recordModelRejection({ model: DEAD, provider: 'openai-codex' })
    const after = await buildPlanInput(planCtx)
    expect(after.candidates.some((c) => c.id === DEAD)).toBe(false)
    expect(after.candidates.some((c) => c.id === LIVE)).toBe(true)
  })

  test('live fetch: the response is overlaid but the caches persist the raw runtime snapshot', async () => {
    recordModelRejection({ model: DEAD })

    const result = await fetchAvailableModels(fakeCtx, { force: true })
    expect(result.cached).toBe(false)
    expect(result.models.find((m) => m.id === DEAD)!.available).toBe(false)

    // The persisted cache must NOT contain overlay state — the ledger is the
    // sole rejection truth, and a droppable cache must never pin it.
    const persisted = readPersistedCache()!
    expect(persisted.models.find((m) => m.id === DEAD)!.available).not.toBe(false)
    expect(persisted.models.find((m) => m.id === DEAD)!.rejection).toBeUndefined()
  })
})
