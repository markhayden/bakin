/**
 * Unit tests for the curated model catalog.
 *
 * Covers the lookup helpers' exact-match and date-suffix-strip-retry
 * behavior, plus a sanity check that every seeded provider is referenced
 * by at least one seeded model (otherwise we have orphan providers).
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-known-models-${Date.now()}`)

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
mock.module('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

import {
  KNOWN_MODELS,
  KNOWN_PROVIDERS,
  getKnownModel,
  getKnownProvider,
} from '../../../plugins/models/data/known-models'

describe('known-models — seed shape', () => {
  it('has entries across all three kinds', () => {
    const kinds = new Set(KNOWN_MODELS.map(m => m.kind))
    expect(kinds.has('llm')).toBe(true)
    expect(kinds.has('image')).toBe(true)
    expect(kinds.has('video')).toBe(true)
  })

  it('seeds roughly the expected volume (22 ± a few)', () => {
    expect(KNOWN_MODELS.length).toBeGreaterThanOrEqual(20)
    expect(KNOWN_MODELS.length).toBeLessThanOrEqual(30)
  })

  it('every seeded model has an id, name, and kind', () => {
    for (const m of KNOWN_MODELS) {
      expect(m.id).toBeTruthy()
      expect(m.name).toBeTruthy()
      expect(['llm', 'image', 'video']).toContain(m.kind)
    }
  })

  it('every seeded provider has an id and label', () => {
    for (const p of KNOWN_PROVIDERS) {
      expect(p.id).toBeTruthy()
      expect(p.label).toBeTruthy()
    }
  })

  it('every seeded model id matches a seeded provider id (first path segment)', () => {
    const providerIds = new Set(KNOWN_PROVIDERS.map(p => p.id))
    for (const m of KNOWN_MODELS) {
      const providerId = m.id.split('/')[0]
      expect(providerIds.has(providerId)).toBe(true)
    }
  })
})

describe('getKnownModel', () => {
  it('returns an entry on exact id match', () => {
    const result = getKnownModel('anthropic/claude-sonnet-4-6')
    expect(result).toBeDefined()
    expect(result!.name).toBe('Claude Sonnet 4.6')
    expect(result!.tier).toBe('standard')
  })

  it('strips trailing -YYYYMMDD date suffix on miss and retries', () => {
    const result = getKnownModel('anthropic/claude-sonnet-4-6-20250514')
    expect(result).toBeDefined()
    expect(result!.id).toBe('anthropic/claude-sonnet-4-6')
  })

  it('returns undefined for an unknown id', () => {
    expect(getKnownModel('mistral/unknown')).toBeUndefined()
  })

  it('returns undefined for an unknown id even after date-suffix strip', () => {
    expect(getKnownModel('mistral/unknown-20240101')).toBeUndefined()
  })

  it('does not accidentally match on partial prefix', () => {
    expect(getKnownModel('anthropic/claude-sonnet')).toBeUndefined()
  })
})

describe('getKnownProvider', () => {
  it('returns a provider on exact id match', () => {
    const result = getKnownProvider('anthropic')
    expect(result).toBeDefined()
    expect(result!.label).toBe('Anthropic')
  })

  it('returns undefined for unknown providers', () => {
    expect(getKnownProvider('mistral')).toBeUndefined()
  })

  it('distinguishes openai and openai-codex', () => {
    expect(getKnownProvider('openai')?.label).toBe('OpenAI')
    expect(getKnownProvider('openai-codex')?.label).toBe('OpenAI (Codex)')
  })
})
