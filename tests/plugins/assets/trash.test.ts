import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-trash-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { softDelete, cleanTrash, listTrash, restoreAsset, permanentDelete, emptyTrash, parseTrashName } from '@bakin/assets/lib/trash'

describe('assets/trash', () => {
  const assetsRoot = join(testDir, 'assets')
  const imagesDir = join(assetsRoot, 'images', 'task123')

  beforeEach(() => {
    mkdirSync(imagesDir, { recursive: true })
    mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('softDelete', () => {
    it('moves asset to .trash/ directory', () => {
      const assetPath = join(imagesDir, 'hero.png')
      writeFileSync(assetPath, 'image-data')

      const result = softDelete(assetPath, assetsRoot)

      expect(result).toBe(true)
      expect(existsSync(assetPath)).toBe(false)

      const trashFiles = readdirSync(join(assetsRoot, '.trash'))
      expect(trashFiles.length).toBe(1)
      expect(trashFiles[0]).toMatch(/^hero\.png__deleted-\d+$/)
    })

    it('moves sidecar alongside asset', () => {
      const assetPath = join(imagesDir, 'hero.png')
      const sidecarPath = assetPath + '.meta.json'
      writeFileSync(assetPath, 'image-data')
      writeFileSync(sidecarPath, JSON.stringify({ agent: 'pixel' }))

      softDelete(assetPath, assetsRoot)

      expect(existsSync(assetPath)).toBe(false)
      expect(existsSync(sidecarPath)).toBe(false)

      const trashFiles = readdirSync(join(assetsRoot, '.trash'))
      expect(trashFiles.length).toBe(2) // asset + sidecar
    })

    it('creates .trash/ if it does not exist', () => {
      rmSync(join(assetsRoot, '.trash'), { recursive: true })
      const assetPath = join(imagesDir, 'test.png')
      writeFileSync(assetPath, 'data')

      softDelete(assetPath, assetsRoot)

      expect(existsSync(join(assetsRoot, '.trash'))).toBe(true)
    })

    it('returns false for nonexistent asset', () => {
      const result = softDelete(join(imagesDir, 'nope.png'), assetsRoot)
      expect(result).toBe(false)
    })
  })

  describe('cleanTrash', () => {
    it('purges files older than TTL', () => {
      const trashDir = join(assetsRoot, '.trash')
      const oldFile = join(trashDir, 'old-file__deleted-1000')
      writeFileSync(oldFile, 'data')
      // Set mtime to 10 days ago
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      utimesSync(oldFile, tenDaysAgo, tenDaysAgo)

      const purged = cleanTrash(assetsRoot, 7)

      expect(purged).toBe(1)
      expect(existsSync(oldFile)).toBe(false)
    })

    it('keeps files newer than TTL', () => {
      const trashDir = join(assetsRoot, '.trash')
      const newFile = join(trashDir, 'new-file__deleted-9999')
      writeFileSync(newFile, 'data')

      const purged = cleanTrash(assetsRoot, 7)

      expect(purged).toBe(0)
      expect(existsSync(newFile)).toBe(true)
    })

    it('returns 0 for empty or missing trash', () => {
      rmSync(join(assetsRoot, '.trash'), { recursive: true })
      expect(cleanTrash(assetsRoot)).toBe(0)
    })
  })

  describe('parseTrashName', () => {
    it('parses valid trash filename', () => {
      const result = parseTrashName('hero.png__deleted-1711324800000')
      expect(result).toEqual({ originalFilename: 'hero.png', deletedAt: 1711324800000 })
    })

    it('returns null for non-trash filenames', () => {
      expect(parseTrashName('hero.png')).toBeNull()
      expect(parseTrashName('hero.png.meta.json')).toBeNull()
    })
  })

  describe('listTrash', () => {
    it('returns parsed trash items with correct fields', () => {
      const trashDir = join(assetsRoot, '.trash')
      const ts = Date.now()
      writeFileSync(join(trashDir, `photo.jpg__deleted-${ts}`), 'image-bytes')
      writeFileSync(join(trashDir, `photo.jpg__deleted-${ts}.meta.json`), JSON.stringify({
        agent: 'pixel',
        taskId: 'task-abc',
        created: '2026-03-20T10:00:00Z',
      }))

      const items = listTrash(assetsRoot)

      expect(items.length).toBe(1)
      expect(items[0].originalFilename).toBe('photo.jpg')
      expect(items[0].type).toBe('images')
      expect(items[0].mimeType).toBe('image/jpeg')
      expect(items[0].metadata?.agent).toBe('pixel')
      expect(items[0].deletedAt).toBeDefined()
      expect(items[0].expiresAt).toBeDefined()
    })

    it('returns empty array when trash is empty', () => {
      const items = listTrash(assetsRoot)
      expect(items).toEqual([])
    })

    it('returns empty array when trash dir does not exist', () => {
      rmSync(join(assetsRoot, '.trash'), { recursive: true })
      const items = listTrash(assetsRoot)
      expect(items).toEqual([])
    })

    it('skips sidecar files in results', () => {
      const trashDir = join(assetsRoot, '.trash')
      const ts = Date.now()
      writeFileSync(join(trashDir, `doc.md__deleted-${ts}`), 'content')
      writeFileSync(join(trashDir, `doc.md__deleted-${ts}.meta.json`), '{}')

      const items = listTrash(assetsRoot)
      expect(items.length).toBe(1)
      expect(items[0].originalFilename).toBe('doc.md')
    })

    it('sorts by deletedAt descending', () => {
      const trashDir = join(assetsRoot, '.trash')
      writeFileSync(join(trashDir, 'older.txt__deleted-1000000'), 'a')
      writeFileSync(join(trashDir, 'newer.txt__deleted-2000000'), 'b')

      const items = listTrash(assetsRoot)
      expect(items[0].originalFilename).toBe('newer.txt')
      expect(items[1].originalFilename).toBe('older.txt')
    })
  })

  describe('restoreAsset', () => {
    it('moves file and sidecar back to the store shard derived from the filename', () => {
      const trashDir = join(assetsRoot, '.trash')
      const ts = Date.now()
      const canonical = '20260320-hero-aaaaaaaa.png'
      const trashFilename = `${canonical}__deleted-${ts}`
      writeFileSync(join(trashDir, trashFilename), 'image-data')
      writeFileSync(join(trashDir, `${trashFilename}.meta.json`), JSON.stringify({
        agent: 'pixel',
        taskId: 'task-xyz',
        created: '2026-03-20T10:00:00Z',
      }))

      const result = restoreAsset(trashFilename, assetsRoot)

      // Under filename-as-identity, restore ignores sidecar taskId and
      // places the file at the shard implied by the canonical filename.
      expect(result).toBe(`assets/store/2026-03/${canonical}`)
      expect(existsSync(join(assetsRoot, 'store', '2026-03', canonical))).toBe(true)
      expect(existsSync(join(assetsRoot, 'store', '2026-03', `${canonical}.meta.json`))).toBe(true)
      expect(existsSync(join(trashDir, trashFilename))).toBe(false)
    })

    it('restores even when the sidecar has no taskId — shard is derived from the filename', () => {
      const trashDir = join(assetsRoot, '.trash')
      const ts = Date.now()
      const canonical = '20260320-doc-bbbbbbbb.md'
      const trashFilename = `${canonical}__deleted-${ts}`
      writeFileSync(join(trashDir, trashFilename), 'text-data')

      const result = restoreAsset(trashFilename, assetsRoot)

      expect(result).toBe(`assets/store/2026-03/${canonical}`)
      expect(existsSync(join(assetsRoot, 'store', '2026-03', canonical))).toBe(true)
    })

    it('returns null when the original filename is non-canonical', () => {
      const trashDir = join(assetsRoot, '.trash')
      const ts = Date.now()
      const trashFilename = `hero.png__deleted-${ts}`
      writeFileSync(join(trashDir, trashFilename), 'image-data')

      const result = restoreAsset(trashFilename, assetsRoot)

      expect(result).toBeNull()
    })

    it('returns null for nonexistent trash item', () => {
      const result = restoreAsset('nope.png__deleted-999', assetsRoot)
      expect(result).toBeNull()
    })
  })

  describe('permanentDelete', () => {
    it('removes file and sidecar from .trash', () => {
      const trashDir = join(assetsRoot, '.trash')
      const ts = Date.now()
      const trashFilename = `photo.jpg__deleted-${ts}`
      writeFileSync(join(trashDir, trashFilename), 'bytes')
      writeFileSync(join(trashDir, `${trashFilename}.meta.json`), '{}')

      const result = permanentDelete(trashFilename, assetsRoot)

      expect(result).toBe(true)
      expect(existsSync(join(trashDir, trashFilename))).toBe(false)
      expect(existsSync(join(trashDir, `${trashFilename}.meta.json`))).toBe(false)
    })

    it('returns false for nonexistent item', () => {
      expect(permanentDelete('nope__deleted-999', assetsRoot)).toBe(false)
    })
  })

  describe('emptyTrash', () => {
    it('purges all items and returns count', () => {
      const trashDir = join(assetsRoot, '.trash')
      const ts = Date.now()
      writeFileSync(join(trashDir, `a.png__deleted-${ts}`), 'a')
      writeFileSync(join(trashDir, `a.png__deleted-${ts}.meta.json`), '{}')
      writeFileSync(join(trashDir, `b.txt__deleted-${ts}`), 'b')

      const deleted = emptyTrash(assetsRoot)

      expect(deleted).toBe(2) // 2 asset files, sidecars don't count
      expect(readdirSync(trashDir).length).toBe(0)
    })

    it('returns 0 for empty trash', () => {
      expect(emptyTrash(assetsRoot)).toBe(0)
    })

    it('returns 0 for missing trash dir', () => {
      rmSync(join(assetsRoot, '.trash'), { recursive: true })
      expect(emptyTrash(assetsRoot)).toBe(0)
    })
  })
})
