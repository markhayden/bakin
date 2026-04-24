/**
 * Tests for inbox ingestion — the manual-drop flow.
 *
 * Covers: type hint from inbox subdir, default to "other", canonical
 * rename into assets/store/{YYYY-MM}/, sidecar shape, dotfile/meta skip,
 * and the startup directory walk.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-inbox-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { ingestInboxFile, ingestInboxDir } from '@bakin/assets/lib/ingest-inbox'
import { isCanonicalFilename, yearMonthFromFilename } from '@bakin/assets/lib/path-for-filename'

function dropIntoInbox(relPath: string, content = 'drop-content'): string {
  const abs = join(testDir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  return relPath
}

describe('assets/ingest-inbox', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('ingestInboxFile', () => {
    it('canonicalizes a file dropped into inbox/images/', () => {
      const rel = dropIntoInbox('assets/inbox/images/my-pic.jpg')
      const result = ingestInboxFile(rel)
      expect(result.ok).toBe(true)
      expect(result.filename).toBeDefined()
      expect(isCanonicalFilename(result.filename!)).toBe(true)
      expect(result.filename).toMatch(/^\d{8}-my-pic-[0-9a-f]{8}\.jpg$/)
      const ym = yearMonthFromFilename(result.filename!)
      expect(result.path).toBe(`assets/store/${ym}/${result.filename}`)
    })

    it('moves the source file out of inbox (rename, not copy)', () => {
      const rel = dropIntoInbox('assets/inbox/images/photo.png')
      const srcAbs = join(testDir, rel)
      expect(existsSync(srcAbs)).toBe(true)
      const result = ingestInboxFile(rel)
      expect(result.ok).toBe(true)
      expect(existsSync(srcAbs)).toBe(false)
      expect(existsSync(join(testDir, result.path!))).toBe(true)
    })

    it('writes a manual-source sidecar with originalFilename preserved', () => {
      const rel = dropIntoInbox('assets/inbox/images/Some Pic!.jpg')
      const result = ingestInboxFile(rel)
      expect(result.ok).toBe(true)
      const metaPath = join(testDir, result.path!) + '.meta.json'
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      expect(meta.agent).toBe('user')
      expect(meta.taskId).toBeNull()
      expect(meta.type).toBe('images')
      expect(meta.source).toBe('manual')
      expect(meta.originalFilename).toBe('Some Pic!.jpg')
      expect(typeof meta.created).toBe('string')
    })

    it('derives type="other" for a root-level drop', () => {
      const rel = dropIntoInbox('assets/inbox/random.bin')
      const result = ingestInboxFile(rel)
      expect(result.ok).toBe(true)
      const meta = JSON.parse(readFileSync(join(testDir, result.path!) + '.meta.json', 'utf-8'))
      expect(meta.type).toBe('other')
    })

    it('derives type="other" for an unknown subdir', () => {
      const rel = dropIntoInbox('assets/inbox/weird/thing.jpg')
      const result = ingestInboxFile(rel)
      expect(result.ok).toBe(true)
      const meta = JSON.parse(readFileSync(join(testDir, result.path!) + '.meta.json', 'utf-8'))
      expect(meta.type).toBe('other')
    })

    it('honors each known type subdir', () => {
      const cases: Array<[string, string]> = [
        ['assets/inbox/video/clip.mp4', 'video'],
        ['assets/inbox/audio/song.mp3', 'audio'],
        ['assets/inbox/pdf/doc.pdf', 'pdf'],
        ['assets/inbox/data/rows.csv', 'data'],
      ]
      for (const [path, expectedType] of cases) {
        const result = ingestInboxFile(dropIntoInbox(path))
        expect(result.ok).toBe(true)
        const meta = JSON.parse(readFileSync(join(testDir, result.path!) + '.meta.json', 'utf-8'))
        expect(meta.type).toBe(expectedType)
      }
    })

    it('skips .meta.json files', () => {
      const rel = dropIntoInbox('assets/inbox/images/leftover.meta.json', '{}')
      const result = ingestInboxFile(rel)
      expect(result.ok).toBe(false)
      expect(existsSync(join(testDir, rel))).toBe(true)
    })

    it('skips dotfiles', () => {
      const rel = dropIntoInbox('assets/inbox/images/.DS_Store', '')
      const result = ingestInboxFile(rel)
      expect(result.ok).toBe(false)
      expect(existsSync(join(testDir, rel))).toBe(true)
    })

    it('rejects paths outside the inbox', () => {
      const result = ingestInboxFile('assets/store/2026-04/stuff.png')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Not an inbox path/)
    })

    it('reports a clear error when the source is missing', () => {
      const result = ingestInboxFile('assets/inbox/images/does-not-exist.png')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Source file not found/)
    })

    it('falls back slug to "dropped" for empty-stem names', () => {
      const rel = dropIntoInbox('assets/inbox/images/.hidden-but-not-really.png')
      // dropIntoInbox drops a dotfile which is skipped — use a name whose
      // stem slugifies to empty instead.
      const rel2 = dropIntoInbox('assets/inbox/images/!!!.png')
      const result = ingestInboxFile(rel2)
      expect(result.ok).toBe(true)
      expect(result.filename).toMatch(/^\d{8}-dropped-[0-9a-f]{8}\.png$/)
    })

    it('defaults extension to "bin" when the source has none', () => {
      const rel = dropIntoInbox('assets/inbox/random')
      const result = ingestInboxFile(rel)
      expect(result.ok).toBe(true)
      expect(result.filename).toMatch(/\.bin$/)
    })
  })

  describe('ingestInboxDir', () => {
    it('returns empty when inbox does not exist', () => {
      const results = ingestInboxDir()
      expect(results).toEqual([])
    })

    it('ingests every eligible file in a single sweep', () => {
      dropIntoInbox('assets/inbox/images/a.jpg')
      dropIntoInbox('assets/inbox/images/b.png')
      dropIntoInbox('assets/inbox/video/c.mp4')
      dropIntoInbox('assets/inbox/d.txt')

      const results = ingestInboxDir()
      const ok = results.filter(r => r.ok)
      expect(ok.length).toBe(4)

      // Every source file has been moved out.
      const inboxEntries = readdirSync(join(testDir, 'assets/inbox'), { recursive: true }) as string[]
      const survivors = inboxEntries.filter(e => {
        const abs = join(testDir, 'assets/inbox', e)
        try {
          return require('fs').statSync(abs).isFile() && !e.toString().startsWith('.')
        } catch {
          return false
        }
      })
      expect(survivors).toEqual([])
    })

    it('skips dotfiles and .meta.json during walk', () => {
      dropIntoInbox('assets/inbox/images/a.jpg')
      dropIntoInbox('assets/inbox/images/.DS_Store', '')
      dropIntoInbox('assets/inbox/images/stray.meta.json', '{}')

      const results = ingestInboxDir()
      const ok = results.filter(r => r.ok)
      expect(ok.length).toBe(1)
      // The skipped files remain on disk.
      expect(existsSync(join(testDir, 'assets/inbox/images/.DS_Store'))).toBe(true)
      expect(existsSync(join(testDir, 'assets/inbox/images/stray.meta.json'))).toBe(true)
    })
  })
})
