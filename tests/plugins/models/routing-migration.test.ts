/**
 * One-shot migration of the origin-shaped routing config ({policies}) into
 * work-class routes. Origin names map 1:1 to the five dispatch work classes;
 * tag overrides carry over unchanged; the old key is gone after write-back.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-routing-migration')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { isLegacyRouting, migrateLegacyRouting } from '../../../plugins/models/lib/routing-migration'

describe('isLegacyRouting', () => {
  it('recognizes the origin-shaped config', () => {
    expect(isLegacyRouting({ policies: [], tagOverrides: [] })).toBe(true)
    expect(isLegacyRouting({ policies: [{ origin: 'adhoc', model: 'm' }], tagOverrides: [] })).toBe(true)
  })
  it('rejects the current shape, empties, and junk', () => {
    expect(isLegacyRouting({ routes: [], tagOverrides: [] })).toBe(false)
    expect(isLegacyRouting(undefined)).toBe(false)
    expect(isLegacyRouting(null)).toBe(false)
    expect(isLegacyRouting('nope')).toBe(false)
    expect(isLegacyRouting({})).toBe(false)
  })
})

describe('migrateLegacyRouting', () => {
  it('maps origins to work classes 1:1 and carries tag overrides', () => {
    const migrated = migrateLegacyRouting({
      policies: [
        { origin: 'scheduled', model: 'anthropic/claude-haiku-4-5', thinking: 'low' },
        { origin: 'recovery', model: 'anthropic/claude-opus-4-6' },
      ],
      tagOverrides: [{ tag: 'heavy', model: 'anthropic/claude-opus-4-6', thinking: 'high' }],
    })
    expect(migrated).toEqual({
      routes: [
        { workClass: 'scheduled', model: 'anthropic/claude-haiku-4-5', thinking: 'low' },
        { workClass: 'recovery', model: 'anthropic/claude-opus-4-6' },
      ],
      tagOverrides: [{ tag: 'heavy', model: 'anthropic/claude-opus-4-6', thinking: 'high' }],
    })
  })

  it('drops unknown origins rather than guessing', () => {
    const migrated = migrateLegacyRouting({
      policies: [{ origin: 'bogus', model: 'm' }, { origin: 'adhoc', model: 'm2' }],
      tagOverrides: [],
    })
    expect(migrated.routes).toEqual([{ workClass: 'adhoc', model: 'm2' }])
  })

  it('handles a bare legacy config with missing arrays', () => {
    expect(migrateLegacyRouting({ policies: [] })).toEqual({ routes: [], tagOverrides: [] })
  })
})
