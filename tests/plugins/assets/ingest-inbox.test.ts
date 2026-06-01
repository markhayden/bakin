/**
 * Tests for inbox ingestion — the manual-drop flow (versioned model).
 *
 * A drop becomes a managed versioned asset (v1) via the asset service; the
 * inbox source file is consumed. Type is inferred from the inbox subdir.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-inbox-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { ingestInboxFile, ingestInboxDir } from '@bakin/assets/lib/ingest-inbox'
import { getAsset } from '@bakin/assets/lib/asset-service'
import { isValidAssetId } from '@bakin/assets/lib/asset-id'

function dropIntoInbox(relPath: string, content = 'drop-content'): string {
  const abs = join(testDir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  return relPath
}

describe('assets/ingest-inbox', () => {
  beforeEach(() => { mkdirSync(testDir, { recursive: true }) })
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }) })

  describe('ingestInboxFile', () => {
    it('creates a versioned asset from a file dropped into inbox/images/', async () => {
      const result = await ingestInboxFile(dropIntoInbox('assets/inbox/images/my-pic.jpg'))
      expect(result.ok).toBe(true)
      expect(isValidAssetId(result.assetId!)).toBe(true)
      expect(result.assetId).toMatch(/^\d{8}-my-pic-[0-9a-f]{8}$/)
      const manifest = getAsset(result.assetId!)!
      expect(manifest.type).toBe('images')
      expect(manifest.currentVersion).toBe(1)
      expect(manifest.versions[0].file).toBe('v1.jpg')
    })

    it('consumes the inbox source file', async () => {
      const rel = dropIntoInbox('assets/inbox/images/photo.png')
      const srcAbs = join(testDir, rel)
      expect(existsSync(srcAbs)).toBe(true)
      const result = await ingestInboxFile(rel)
      expect(result.ok).toBe(true)
      expect(existsSync(srcAbs)).toBe(false)
    })

    it('records user agent, null task, and upload source in the manifest', async () => {
      const result = await ingestInboxFile(dropIntoInbox('assets/inbox/images/Some Pic!.jpg'))
      const manifest = getAsset(result.assetId!)!
      expect(manifest.agent).toBe('user')
      expect(manifest.taskId).toBeNull()
      expect(manifest.type).toBe('images')
      expect(manifest.source.kind).toBe('upload')
    })

    it('derives type="other" for a root-level drop and an unknown subdir', async () => {
      const a = await ingestInboxFile(dropIntoInbox('assets/inbox/random.bin'))
      expect(getAsset(a.assetId!)!.type).toBe('other')
      const b = await ingestInboxFile(dropIntoInbox('assets/inbox/weird/thing.jpg'))
      expect(getAsset(b.assetId!)!.type).toBe('other')
    })

    it('honors each known type subdir', async () => {
      const cases: Array<[string, string]> = [
        ['assets/inbox/video/clip.mp4', 'video'],
        ['assets/inbox/audio/song.mp3', 'audio'],
        ['assets/inbox/pdf/doc.pdf', 'pdf'],
        ['assets/inbox/data/rows.csv', 'data'],
      ]
      for (const [path, expectedType] of cases) {
        const result = await ingestInboxFile(dropIntoInbox(path))
        expect(result.ok).toBe(true)
        expect(getAsset(result.assetId!)!.type).toBe(expectedType)
      }
    })

    it('skips .meta.json files and dotfiles (leaves them on disk)', async () => {
      const meta = dropIntoInbox('assets/inbox/images/leftover.meta.json', '{}')
      const r1 = await ingestInboxFile(meta)
      expect(r1.ok).toBe(false)
      expect(existsSync(join(testDir, meta))).toBe(true)

      const dot = dropIntoInbox('assets/inbox/images/.DS_Store', '')
      const r2 = await ingestInboxFile(dot)
      expect(r2.ok).toBe(false)
      expect(existsSync(join(testDir, dot))).toBe(true)
    })

    it('rejects paths outside the inbox and missing sources', async () => {
      expect((await ingestInboxFile('assets/store/2026-04/stuff.png')).error).toMatch(/Not an inbox path/)
      expect((await ingestInboxFile('assets/inbox/images/does-not-exist.png')).error).toMatch(/Source file not found/)
    })

    it('falls back slug to "dropped" and ext to "bin"', async () => {
      const slugged = await ingestInboxFile(dropIntoInbox('assets/inbox/images/!!!.png'))
      expect(slugged.assetId).toMatch(/^\d{8}-dropped-[0-9a-f]{8}$/)
      const noext = await ingestInboxFile(dropIntoInbox('assets/inbox/random'))
      expect(getAsset(noext.assetId!)!.versions[0].file).toBe('v1.bin')
    })
  })

  describe('ingestInboxDir', () => {
    it('returns empty when inbox does not exist', async () => {
      expect(await ingestInboxDir()).toEqual([])
    })

    it('ingests every eligible file and consumes the sources', async () => {
      dropIntoInbox('assets/inbox/images/a.jpg')
      dropIntoInbox('assets/inbox/images/b.png')
      dropIntoInbox('assets/inbox/video/c.mp4')
      dropIntoInbox('assets/inbox/d.txt')

      const results = await ingestInboxDir()
      expect(results.filter(r => r.ok).length).toBe(4)
      const survivors = (readdirSync(join(testDir, 'assets/inbox'), { recursive: true }) as string[])
        .filter(e => { try { return require('fs').statSync(join(testDir, 'assets/inbox', e)).isFile() && !e.toString().startsWith('.') } catch { return false } })
      expect(survivors).toEqual([])
    })

    it('skips dotfiles and .meta.json during the walk', async () => {
      dropIntoInbox('assets/inbox/images/a.jpg')
      dropIntoInbox('assets/inbox/images/.DS_Store', '')
      dropIntoInbox('assets/inbox/images/stray.meta.json', '{}')

      const results = await ingestInboxDir()
      expect(results.filter(r => r.ok).length).toBe(1)
      expect(existsSync(join(testDir, 'assets/inbox/images/.DS_Store'))).toBe(true)
      expect(existsSync(join(testDir, 'assets/inbox/images/stray.meta.json'))).toBe(true)
    })
  })
})
