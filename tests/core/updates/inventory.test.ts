/** Subject inventory: kind-prefixed ids, stable fingerprints, one entry per subject. */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testDir = join(tmpdir(), `bakin-test-updates-inventory-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { collectInventory, fingerprintOf, updateRecordId } from '../../../src/core/updates/inventory'
import type { UpdateSource } from '../../../src/core/updates/types'

function source(kind: UpdateSource['kind'], ids: string[]): UpdateSource {
  return {
    kind,
    inventory: async () => ids.map((id) => ({
      subject: { kind, id, label: id },
      group: 'available' as const,
      fingerprint: fingerprintOf({ id }),
      source: { kind: 'test', endpoint: `test://${id}` },
    })),
    observe: async () => { throw new Error('not observed in this test') },
  }
}

describe('fingerprintOf', () => {
  it('is stable across key order and nesting, and changes with any value', () => {
    expect(fingerprintOf({ a: 1, b: { c: [1, 2] } })).toBe(fingerprintOf({ b: { c: [1, 2] }, a: 1 }))
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ a: 2 }))
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ a: '1' }))
    expect(fingerprintOf({ a: undefined })).toBe(fingerprintOf({}))
    expect(fingerprintOf('absent')).toMatch(/^[0-9a-f]{24}$/)
  })
})

describe('collectInventory', () => {
  it('prefixes every subject id with its kind and keeps each source\'s own order', async () => {
    const entries = await collectInventory([source('plugin', ['projects', 'terminal']), source('package', ['projects'])])
    expect(entries.map((entry) => updateRecordId(entry.subject))).toEqual(['plugin:projects', 'plugin:terminal', 'package:projects'])
  })

  it('a source whose inventory throws is reported, not fatal: the other sources still enumerate', async () => {
    const broken: UpdateSource = { kind: 'gateway', inventory: async () => { throw new Error('runtime down') }, observe: async () => { throw new Error('x') } }
    const failures: string[] = []
    const entries = await collectInventory([broken, source('bakin', ['bakin'])], { onSourceError: (kind, error) => failures.push(`${kind}:${error.message}`) })
    expect(entries.map((entry) => updateRecordId(entry.subject))).toEqual(['bakin:bakin'])
    expect(failures).toEqual(['gateway:runtime down'])
  })

  it('a source that returns a subject of another kind is rejected (ids are partitioned by kind)', async () => {
    const liar: UpdateSource = {
      kind: 'package',
      inventory: async () => [{ subject: { kind: 'hub-skill', id: 'x', label: 'x' }, group: 'available', fingerprint: 'f', source: { kind: 't', endpoint: 'e' } }],
      observe: async () => { throw new Error('x') },
    }
    const failures: string[] = []
    const entries = await collectInventory([liar], { onSourceError: (kind, error) => failures.push(`${kind}:${error.message}`) })
    expect(entries).toEqual([])
    expect(failures[0]).toMatch(/^package:.*hub-skill/)
  })
})
