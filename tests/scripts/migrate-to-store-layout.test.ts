/**
 * Unit tests for the one-shot legacy → store layout migration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testRoot = join(tmpdir(), `bakin-migration-${Date.now()}`)
const assetsRoot = join(testRoot, 'assets')

// The migration module walks the assetsRoot passed into it, not ~/.bakin/.
// The mock is a belt-and-suspenders guard against any transitive import
// accidentally introducing a call to getContentDir.
vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testRoot,
  getBakinPaths: () => ({ assets: assetsRoot }),
}))

import {
  canonicalizeFilename,
  migrateToStoreLayout,
} from '../../scripts/lib/migrate-to-store-layout'

function seed(relPath: string, body: string | Record<string, unknown>): string {
  const abs = join(assetsRoot, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  writeFileSync(abs, data)
  return abs
}

function setMtime(abs: string, isoDate: string): void {
  const d = new Date(isoDate)
  utimesSync(abs, d, d)
}

function readJson(abs: string): Record<string, unknown> {
  return JSON.parse(readFileSync(abs, 'utf-8')) as Record<string, unknown>
}

describe('migrate-to-store-layout', () => {
  beforeEach(() => {
    mkdirSync(assetsRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  describe('canonicalizeFilename', () => {
    it('returns canonical filenames unchanged', () => {
      const r = canonicalizeFilename('20260401-hero-a1b2c3d4.png', null, null)
      expect(r.filename).toBe('20260401-hero-a1b2c3d4.png')
      expect(r.renamed).toBe(false)
    })

    it('prepends date when filename has id8 but no date prefix', () => {
      const r = canonicalizeFilename('hero-a1b2c3d4.png', new Date('2026-03-15T00:00:00Z'), null)
      expect(r.filename).toBe('20260315-hero-a1b2c3d4.png')
      expect(r.renamed).toBe(true)
    })

    it('generates a fresh id8 when filename has neither date nor id8', () => {
      const r = canonicalizeFilename('Hero Pic!.png', new Date('2026-03-15T00:00:00Z'), null)
      expect(r.filename).toMatch(/^20260315-hero-pic-[0-9a-f]{8}\.png$/)
      expect(r.renamed).toBe(true)
    })

    it('falls back to file mtime when sidecar has no created', () => {
      const r = canonicalizeFilename('plain.png', null, new Date('2026-02-09T00:00:00Z'))
      expect(r.filename).toMatch(/^20260209-plain-[0-9a-f]{8}\.png$/)
    })

    it('defaults extension to bin when source has none', () => {
      const r = canonicalizeFilename('random', new Date('2026-04-01T00:00:00Z'), null)
      expect(r.filename).toMatch(/\.bin$/)
    })

    it('slugs empty stem to "asset"', () => {
      const r = canonicalizeFilename('!!!.png', new Date('2026-04-01T00:00:00Z'), null)
      expect(r.filename).toMatch(/^20260401-asset-[0-9a-f]{8}\.png$/)
    })
  })

  describe('migrateToStoreLayout', () => {
    it('moves a canonical-named asset to store/{YYYY-MM}/ and merges metadata', () => {
      const asset = seed('images/task-abc/20260401-hero-deadbeef.png', 'PNG-BYTES')
      seed('images/task-abc/20260401-hero-deadbeef.png.meta.json', {
        agent: 'pixel', taskId: 'old-value', created: '2026-04-01T00:00:00.000Z',
      })

      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })

      expect(result.scanned).toBe(1)
      expect(result.moved).toBe(1)
      expect(result.renamed).toBe(0)

      const dest = join(assetsRoot, 'store', '2026-04', '20260401-hero-deadbeef.png')
      expect(existsSync(dest)).toBe(true)
      expect(existsSync(asset)).toBe(false)

      const sidecar = readJson(`${dest}.meta.json`)
      expect(sidecar.type).toBe('images')
      expect(sidecar.taskId).toBe('task-abc')
      expect(sidecar.agent).toBe('pixel')
    })

    it('renames non-canonical filenames using sidecar.created', () => {
      seed('images/task-abc/hero.png', 'PNG')
      seed('images/task-abc/hero.png.meta.json', {
        agent: 'pixel', taskId: 'task-abc', created: '2026-03-11T00:00:00.000Z',
      })

      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })

      expect(result.moved).toBe(1)
      expect(result.renamed).toBe(1)
      const marchDir = join(assetsRoot, 'store', '2026-03')
      const files = readdirSync(marchDir).filter(f => !f.endsWith('.meta.json'))
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/^20260311-hero-[0-9a-f]{8}\.png$/)

      const sidecar = readJson(join(marchDir, `${files[0]}.meta.json`))
      expect(sidecar.type).toBe('images')
      expect(sidecar.taskId).toBe('task-abc')
      expect(sidecar.originalFilename).toBe('hero.png')
    })

    it('falls back to file mtime when sidecar has no created', () => {
      const abs = seed('images/task-xyz/pic.png', 'PNG')
      seed('images/task-xyz/pic.png.meta.json', { agent: 'pixel', taskId: 'task-xyz' })
      setMtime(abs, '2026-02-20T00:00:00.000Z')

      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })
      expect(result.moved).toBe(1)
      const febDir = join(assetsRoot, 'store', '2026-02')
      expect(existsSync(febDir)).toBe(true)
    })

    it('preserves null taskId for _unlinked/ and library/ subdirs', () => {
      seed('images/_unlinked/20260401-stray-aaaaaaaa.png', 'PNG')
      seed('images/_unlinked/20260401-stray-aaaaaaaa.png.meta.json', {
        agent: 'pixel', taskId: null, created: '2026-04-01T00:00:00Z',
      })
      seed('data/library/20260315-shared-bbbbbbbb.csv', 'csv')
      seed('data/library/20260315-shared-bbbbbbbb.csv.meta.json', {
        agent: 'analyst', taskId: null, created: '2026-03-15T00:00:00Z',
      })

      migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })

      const apr = readJson(join(assetsRoot, 'store', '2026-04', '20260401-stray-aaaaaaaa.png.meta.json'))
      expect(apr.taskId).toBeNull()
      expect(apr.type).toBe('images')

      const mar = readJson(join(assetsRoot, 'store', '2026-03', '20260315-shared-bbbbbbbb.csv.meta.json'))
      expect(mar.taskId).toBeNull()
      expect(mar.type).toBe('data')
    })

    it('synthesizes a sidecar for orphan assets', () => {
      const abs = seed('pdf/task-def/20260405-doc-cccccccc.pdf', 'PDF')
      setMtime(abs, '2026-04-05T00:00:00Z')

      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })

      expect(result.scanned).toBe(1)
      expect(result.moved).toBe(1)
      expect(result.sidecarCreated).toBe(1)
      expect(result.orphanAssets.length).toBe(1)

      const dest = join(assetsRoot, 'store', '2026-04', '20260405-doc-cccccccc.pdf')
      expect(existsSync(dest)).toBe(true)
      const sidecar = readJson(`${dest}.meta.json`)
      expect(sidecar.type).toBe('pdf')
      expect(sidecar.taskId).toBe('task-def')
      expect(sidecar.agent).toBe('unknown')
      expect(sidecar.created).toBeDefined()
    })

    it('reports orphan sidecars without moving them', () => {
      seed('images/task-abc/ghost.png.meta.json', {
        agent: 'pixel', taskId: 'task-abc', created: '2026-04-01T00:00:00Z',
      })

      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })

      expect(result.moved).toBe(0)
      expect(result.orphanSidecars.length).toBe(1)
      // Orphan sidecar stays in place.
      expect(existsSync(join(assetsRoot, 'images/task-abc/ghost.png.meta.json'))).toBe(true)
    })

    it('moves .trash to store/.trash and preserves filenames', () => {
      seed('.trash/20260401-old-eeeeeeee.png__deleted-1712000000000', 'PNG')
      seed('.trash/20260401-old-eeeeeeee.png__deleted-1712000000000.meta.json', {
        agent: 'pixel', taskId: null, created: '2026-04-01T00:00:00Z',
      })

      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })
      expect(result.trashMoved).toBe(2)

      const trashDir = join(assetsRoot, 'store', '.trash')
      const entries = readdirSync(trashDir)
      expect(entries.length).toBe(2)
      expect(existsSync(join(assetsRoot, '.trash'))).toBe(false)
    })

    it('removes empty legacy type dirs when nothing remains', () => {
      seed('images/task-abc/20260401-hero-dddddddd.png', 'PNG')
      seed('images/task-abc/20260401-hero-dddddddd.png.meta.json', {
        agent: 'pixel', taskId: 'task-abc', created: '2026-04-01T00:00:00Z',
      })

      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })
      expect(result.emptyDirsRemoved).toBeGreaterThan(0)
      expect(existsSync(join(assetsRoot, 'images'))).toBe(false)
    })

    it('dry-run never touches the filesystem', () => {
      seed('images/task-abc/hero.png', 'PNG')
      seed('images/task-abc/hero.png.meta.json', {
        agent: 'pixel', taskId: 'task-abc', created: '2026-04-01T00:00:00Z',
      })

      const beforeEntries = readdirSync(join(assetsRoot, 'images/task-abc'))

      const result = migrateToStoreLayout({ assetsRoot, dryRun: true, log: () => {} })

      expect(result.moved).toBe(1)
      expect(result.renamed).toBe(1)
      // Source untouched
      expect(readdirSync(join(assetsRoot, 'images/task-abc'))).toEqual(beforeEntries)
      expect(existsSync(join(assetsRoot, 'store'))).toBe(false)
    })

    it('resolves filename collisions by regenerating id8', () => {
      // Two distinct legacy files whose canonical form would collide.
      seed('images/task-a/20260401-hero-cafebabe.png', 'PNG-1')
      seed('images/task-a/20260401-hero-cafebabe.png.meta.json', {
        agent: 'pixel', taskId: 'task-a', created: '2026-04-01T00:00:00Z',
      })
      // Pre-seed a file in store/ that already claims the canonical name.
      seed('store/2026-04/20260401-hero-cafebabe.png', 'EXISTING')
      seed('store/2026-04/20260401-hero-cafebabe.png.meta.json', {
        agent: 'other', taskId: 'task-b', created: '2026-04-01T00:00:00Z', type: 'images',
      })

      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })
      expect(result.moved).toBe(1)
      expect(result.renamed).toBe(1)
      // Both files now coexist under store/2026-04/ with distinct filenames.
      const aprFiles = readdirSync(join(assetsRoot, 'store', '2026-04'))
        .filter(f => !f.endsWith('.meta.json'))
      expect(aprFiles.length).toBe(2)
    })

    it('returns empty result when assets root does not exist', () => {
      rmSync(assetsRoot, { recursive: true, force: true })
      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })
      expect(result.scanned).toBe(0)
      expect(result.moved).toBe(0)
    })

    it('ignores inbox/ and store/ during the legacy walk', () => {
      seed('inbox/foo.png', 'IN')
      seed('store/2026-04/20260401-already-ffffffff.png', 'OK')

      const result = migrateToStoreLayout({ assetsRoot, dryRun: false, log: () => {} })
      expect(result.scanned).toBe(0)
      // Pre-existing store/ file preserved.
      expect(existsSync(join(assetsRoot, 'store/2026-04/20260401-already-ffffffff.png'))).toBe(true)
      // Inbox left alone.
      expect(existsSync(join(assetsRoot, 'inbox/foo.png'))).toBe(true)
    })
  })
})
