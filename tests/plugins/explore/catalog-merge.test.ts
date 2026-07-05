/**
 * Pure merge-rule tests: embedded ⊕ cached remote. Remote wins per
 * (kind,id) EXCEPT builtin — remote catalogs can neither override nor
 * introduce builtin listings.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-explore-merge-${Date.now()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = `${testDir}-openclaw`

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { mergeCatalogs } from '../../../plugins/explore/lib/catalog'
import type { CatalogEntry, CatalogFile } from '../../../src/core/curated-catalog/schema'

const entry = (id: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  kind: 'agent',
  name: id,
  description: 'x',
  category: 'Test',
  tags: [],
  useCases: [],
  source: `github:markhayden/bakin-bits-official#agents/${id}`,
  ref: null,
  trust: 'official',
  builtin: false,
  dependencies: [],
  defaultSelected: false,
  screenshots: [],
  ...over,
})

const file = (entries: CatalogEntry[], updatedAt = 'embedded-date'): CatalogFile => ({
  version: 2,
  updatedAt,
  entries,
})

describe('mergeCatalogs', () => {
  it('no remote → embedded as-is with null remoteUpdatedAt', () => {
    const merged = mergeCatalogs(file([entry('pixel')]), null)
    expect(merged.entries.map(e => e.id)).toEqual(['pixel'])
    expect(merged.remoteUpdatedAt).toBeNull()
  })

  it('remote overrides matching non-builtin entries and adds new ones', () => {
    const merged = mergeCatalogs(
      file([entry('pixel', { name: 'Pixel v1' })]),
      file([entry('pixel', { name: 'Pixel v2' }), entry('newbie')], 'remote-date'),
    )
    expect(merged.entries.find(e => e.id === 'pixel')?.name).toBe('Pixel v2')
    expect(merged.entries.map(e => e.id).sort()).toEqual(['newbie', 'pixel'])
    expect(merged.remoteUpdatedAt).toBe('remote-date')
  })

  it('remote cannot override an embedded builtin entry', () => {
    const merged = mergeCatalogs(
      file([entry('team', { kind: 'plugin', builtin: true, source: undefined, name: 'Team' })]),
      file([entry('team', { kind: 'plugin', name: 'Hijacked', source: 'github:evil/repo#plugins/team' })]),
    )
    expect(merged.entries.find(e => e.id === 'team')?.name).toBe('Team')
  })

  it('remote can never claim a core plugin id, even one embedded forgot to list', () => {
    const merged = mergeCatalogs(
      file([entry('pixel')]),
      file([entry('git', { kind: 'plugin', source: 'github:evil/repo#plugins/git' })]),
    )
    expect(merged.entries.find(e => e.id === 'git')).toBeUndefined()
  })

  it('remote cannot introduce a new builtin listing', () => {
    const merged = mergeCatalogs(
      file([entry('pixel')]),
      file([entry('sneaky', { kind: 'plugin', builtin: true, source: undefined })]),
    )
    expect(merged.entries.find(e => e.id === 'sneaky')).toBeUndefined()
  })

  it('same id under different kinds are distinct entries', () => {
    const merged = mergeCatalogs(
      file([entry('shared', { kind: 'agent' })]),
      file([entry('shared', { kind: 'lesson-pack', source: 'github:x#packs/shared' })]),
    )
    expect(merged.entries).toHaveLength(2)
  })
})
