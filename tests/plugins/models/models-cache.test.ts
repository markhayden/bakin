/**
 * Unit tests for the persistent models cache.
 *
 * Round-trip, corrupt-JSON, missing-file, and clear-deletes — mirrors the
 * coverage pattern used for notification-channel-registry + messaging
 * content-type cache.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-test-models-cache-'))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

import {
  clearPersistedCache,
  readPersistedCache,
  writePersistedCache,
} from '../../../plugins/models/lib/models-cache'
import type { AvailableModel } from '../../../plugins/models/types'

const CACHE_FILE = join(testDir, 'plugin-settings', 'models', 'available.json')

const FIXTURE_MODELS: AvailableModel[] = [
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'standard', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5',  name: 'Claude Haiku 4.5',  tier: 'budget',   provider: 'anthropic' },
]

beforeEach(() => {
  clearPersistedCache()
})

afterEach(() => {
  clearPersistedCache()
})

describe('models-cache — round-trip', () => {
  it('writes then reads the same shape', () => {
    const now = Date.now()
    writePersistedCache({ models: FIXTURE_MODELS, fetchedAt: now, source: 'runtime' })
    const read = readPersistedCache()
    expect(read).not.toBeNull()
    expect(read!.fetchedAt).toBe(now)
    expect(read!.source).toBe('runtime')
    expect(read!.models).toHaveLength(2)
    expect(read!.models[0].id).toBe('anthropic/claude-sonnet-4-6')
  })

  it('creates the parent directory if missing', () => {
    // testDir exists but the plugin-settings/models/ subdir does not yet.
    writePersistedCache({ models: FIXTURE_MODELS, fetchedAt: Date.now(), source: 'runtime' })
    expect(existsSync(CACHE_FILE)).toBe(true)
  })

  it('persists optional extra fields on each model', () => {
    const enriched: AvailableModel = {
      id: 'anthropic/claude-opus-4-6',
      name: 'Claude Opus 4.6',
      tier: 'premium',
      provider: 'anthropic',
      description: 'Flagship reasoning model',
    } as AvailableModel
    writePersistedCache({ models: [enriched], fetchedAt: Date.now(), source: 'runtime' })
    const read = readPersistedCache()
    expect((read!.models[0] as AvailableModel & { description?: string }).description).toBe('Flagship reasoning model')
  })
})

describe('models-cache — error paths', () => {
  it('returns null when the cache file is missing', () => {
    expect(readPersistedCache()).toBeNull()
  })

  it('returns null AND deletes the file when JSON is corrupt', () => {
    mkdirSync(join(testDir, 'plugin-settings', 'models'), { recursive: true })
    writeFileSync(CACHE_FILE, '{ this is not json')
    expect(readPersistedCache()).toBeNull()
    expect(existsSync(CACHE_FILE)).toBe(false)
  })

  it('returns null AND deletes the file when the shape fails zod validation', () => {
    mkdirSync(join(testDir, 'plugin-settings', 'models'), { recursive: true })
    // Missing `fetchedAt` and `source` — schema drift simulation.
    writeFileSync(CACHE_FILE, JSON.stringify({ models: FIXTURE_MODELS }))
    expect(readPersistedCache()).toBeNull()
    expect(existsSync(CACHE_FILE)).toBe(false)
  })
})

describe('models-cache — clear', () => {
  it('deletes an existing cache file', () => {
    writePersistedCache({ models: FIXTURE_MODELS, fetchedAt: Date.now(), source: 'runtime' })
    expect(existsSync(CACHE_FILE)).toBe(true)
    clearPersistedCache()
    expect(existsSync(CACHE_FILE)).toBe(false)
  })

  it('is a no-op when the file does not exist', () => {
    expect(() => clearPersistedCache()).not.toThrow()
  })
})

// Cleanup the test tmpdir entirely on process exit.
afterEach(() => {
  // Guard against the dir being removed by the main cleanup below
})
process.on('exit', () => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('fetchAvailableModels — cache-served tiers are recomputed', () => {
  it('a persisted cache with stale tier labels serves fresh heuristic tiers', async () => {
    const { fetchAvailableModels, setModelsCache } = await import('../../../plugins/models/lib/available-models')
    setModelsCache(null)
    // Written by an old heuristic that labeled the mini model premium.
    writePersistedCache({
      models: [
        { id: 'openai-codex/gpt-5.4-mini', name: 'GPT-5.4 Mini', tier: 'premium', provider: 'openai-codex' },
        { id: 'openai-codex/gpt-5.5', name: 'GPT-5.5', tier: 'premium', provider: 'openai-codex' },
      ] as AvailableModel[],
      fetchedAt: Date.now(),
      source: 'runtime',
    })
    const result = await fetchAvailableModels({} as never)
    expect(result.cached).toBe(true)
    const byId = new Map(result.models.map((m) => [m.id, m]))
    expect(byId.get('openai-codex/gpt-5.4-mini')?.tier).toBe('budget') // recomputed, not the stale label
    expect(byId.get('openai-codex/gpt-5.5')?.tier).toBe('premium')
  })
})
