/**
 * Unit tests for the persistent models cache.
 *
 * Round-trip, corrupt-JSON, missing-file, and clear-deletes — mirrors the
 * coverage pattern used for notification-channel-registry + messaging
 * content-type cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-test-models-cache-'))

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../../plugins/tasks/lib/flow-store', () => ({
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
    writePersistedCache({ models: FIXTURE_MODELS, fetchedAt: now, source: 'openclaw' })
    const read = readPersistedCache()
    expect(read).not.toBeNull()
    expect(read!.fetchedAt).toBe(now)
    expect(read!.source).toBe('openclaw')
    expect(read!.models).toHaveLength(2)
    expect(read!.models[0].id).toBe('anthropic/claude-sonnet-4-6')
  })

  it('creates the parent directory if missing', () => {
    // testDir exists but the plugin-settings/models/ subdir does not yet.
    writePersistedCache({ models: FIXTURE_MODELS, fetchedAt: Date.now(), source: 'openclaw' })
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
    writePersistedCache({ models: [enriched], fetchedAt: Date.now(), source: 'openclaw' })
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
    writePersistedCache({ models: FIXTURE_MODELS, fetchedAt: Date.now(), source: 'openclaw' })
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
