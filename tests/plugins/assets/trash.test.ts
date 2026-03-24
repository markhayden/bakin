import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { softDelete, cleanTrash } from '@mc/assets/lib/trash'

describe('assets/trash', () => {
  const testDir = join(tmpdir(), `beacon-test-trash-${Date.now()}`)
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
})
