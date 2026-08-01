/**
 * Explicit import of unmanaged files (D7). The ONE rule: nothing on disk
 * becomes an asset without an explicit import call — these tests cover the
 * classifier, the readdir-only scan, the import action (op:'import',
 * source consumed), and the live tracker that feeds the badge.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-import-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: () => () => {},
  registerUnlinkHook: () => () => {},
}))

import {
  isUnmanagedAssetPath,
  scanUnmanaged,
  importUnmanagedFile,
  importAllUnmanaged,
  suggestTypeFor,
} from '@bakin/assets/lib/import-unmanaged'
import {
  noteUnmanagedSync,
  noteUnmanagedUnlink,
  reseedUnmanaged,
  unmanagedCount,
  resetUnmanagedTrackerForTests,
  setUnmanagedEmitter,
} from '@bakin/assets/lib/unmanaged-tracker'
import { getAsset } from '@bakin/assets/lib/asset-service'
import { isValidAssetId } from '@bakin/assets/lib/asset-id'
import { waitUntil } from '../../helpers/wait'

function drop(relPath: string, content = 'file-content'): string {
  const abs = join(testDir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  return relPath
}

describe('assets/import-unmanaged', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    resetUnmanagedTrackerForTests()
  })
  afterEach(() => {
    setUnmanagedEmitter(null)
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('isUnmanagedAssetPath (the classifier)', () => {
    it('inbox leftovers, legacy flat files, and user folders are unmanaged', () => {
      expect(isUnmanagedAssetPath('assets/inbox/pic.png')).toBe(true)
      expect(isUnmanagedAssetPath('assets/inbox/images/pic.png')).toBe(true)
      expect(isUnmanagedAssetPath('assets/legacy-flat.pdf')).toBe(true)
      expect(isUnmanagedAssetPath('assets/store/2026-07/loose.txt')).toBe(true)
      expect(isUnmanagedAssetPath('assets/my-folder/notes.md')).toBe(true)
    })
    it('managed store files, trash, dotfiles, and sidecars are NOT unmanaged', () => {
      expect(isUnmanagedAssetPath('assets/store/2026-07/20260702-hero-abcd1234/manifest.json')).toBe(false)
      expect(isUnmanagedAssetPath('assets/store/2026-07/20260702-hero-abcd1234/v1.png')).toBe(false)
      expect(isUnmanagedAssetPath('assets/.trash/old.png')).toBe(false)
      expect(isUnmanagedAssetPath('assets/inbox/.DS_Store')).toBe(false)
      expect(isUnmanagedAssetPath('assets/inbox/old.meta.json')).toBe(false)
      expect(isUnmanagedAssetPath('tasks/whatever.md')).toBe(false)
    })
  })

  describe('suggestTypeFor', () => {
    it('inbox subdir hint wins; extension decides otherwise', () => {
      expect(suggestTypeFor('assets/inbox/images/whatever.bin')).toBe('images')
      expect(suggestTypeFor('assets/inbox/photo.jpg')).toBe('images')
      expect(suggestTypeFor('assets/loose/report.pdf')).toBe('pdf')
      expect(suggestTypeFor('assets/loose/unknown.xyz')).toBe('other')
    })
  })

  describe('scanUnmanaged', () => {
    it('lists unmanaged files, never store-managed or trashed ones', async () => {
      drop('assets/inbox/dropped.png')
      drop('assets/legacy.pdf')
      drop('assets/.trash/gone.png')
      // a real managed asset (via import) must NOT appear
      const imported = await importUnmanagedFile(drop('assets/inbox/managed-me.txt'))
      expect(imported.ok).toBe(true)

      const files = scanUnmanaged()
      const rels = files.map(f => f.relPath).sort()
      expect(rels).toEqual(['assets/inbox/dropped.png', 'assets/legacy.pdf'])
      const png = files.find(f => f.relPath === 'assets/inbox/dropped.png')!
      expect(png.suggestedType).toBe('images')
      expect(png.size).toBeGreaterThan(0)
    })
  })

  describe('importUnmanagedFile', () => {
    it('creates a versioned asset with op import and consumes the source', async () => {
      const rel = drop('assets/inbox/images/my-pic.jpg')
      const result = await importUnmanagedFile(rel)
      expect(result.ok).toBe(true)
      expect(isValidAssetId(result.assetId!)).toBe(true)
      const manifest = getAsset(result.assetId!)!
      expect(manifest.type).toBe('images')
      expect(manifest.agent).toBe('user')
      expect(manifest.versions[0].op).toBe('import')
      expect(manifest.source.kind).toBe('import')
      expect(manifest.source.path).toBe(rel)
      expect(existsSync(join(testDir, rel))).toBe(false) // consumed
    })

    it('honors an explicit type override and rejects managed paths', async () => {
      const rel = drop('assets/loose-notes.bin')
      const result = await importUnmanagedFile(rel, { type: 'research' })
      expect(result.ok).toBe(true)
      expect(getAsset(result.assetId!)!.type).toBe('research')

      const bad = await importUnmanagedFile('assets/store/2026-07/20260702-hero-abcd1234/v1.png')
      expect(bad.ok).toBe(false)
    })

    it('importAllUnmanaged drains the scan list', async () => {
      drop('assets/inbox/a.txt')
      drop('assets/inbox/b.txt')
      const results = await importAllUnmanaged()
      expect(results.filter(r => r.ok)).toHaveLength(2)
      expect(scanUnmanaged()).toHaveLength(0)
    })
  })

  describe('unmanaged tracker', () => {
    it('notes syncs/unlinks for unmanaged paths only and reseeds from scans', () => {
      noteUnmanagedSync('assets/inbox/x.png')
      noteUnmanagedSync('assets/store/2026-07/20260702-hero-abcd1234/manifest.json')
      expect(unmanagedCount()).toBe(1)
      noteUnmanagedUnlink('assets/inbox/x.png')
      expect(unmanagedCount()).toBe(0)
      reseedUnmanaged(['assets/a.png', 'assets/b.png'])
      expect(unmanagedCount()).toBe(2)
    })

    it('emits a debounced count', async () => {
      const counts: number[] = []
      setUnmanagedEmitter(c => counts.push(c))
      noteUnmanagedSync('assets/inbox/one.png')
      noteUnmanagedSync('assets/inbox/two.png')
      await waitUntil(() => counts.length > 0,
        { label: 'the unmanaged-file debounce to emit its batched count' })
      expect(counts).toEqual([2])
    })
  })
})
