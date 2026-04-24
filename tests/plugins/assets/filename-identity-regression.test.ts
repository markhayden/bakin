/**
 * Incident regression — filename-as-identity invariants.
 *
 * This suite encodes the bug that motivated the storage redesign:
 * project ff335816 / task 64aabe60 blocked because a UI retype
 * physically moved an asset while every project-manifest reference
 * to that asset continued to hold the old path as a string. Agents
 * reading the manifest followed a stale path, hit ENOENT, and
 * stalled.
 *
 * Under filename-as-identity the invariant is simple:
 *
 *   For every canonical filename F, at every point in time,
 *   join(contentDir, pathForFilename(F)) is the file's live path.
 *
 * Retype, relink, restore — none of them are allowed to break that
 * equation. These tests prove it by simulating a manifest that
 * holds only the filename (no path) and running it through the
 * same mutation sequence the ff335816 incident triggered.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-identity-regression-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: assetsRoot }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { retypeAsset } from '@bakin/assets/lib/retype'
import { relinkAsset } from '@bakin/assets/lib/relink'
import { softDelete, restoreAsset } from '@bakin/assets/lib/trash'
import { pathForFilename } from '@bakin/assets/lib/path-for-filename'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

/** Resolve a filename the way a manifest-consumer would. */
function resolveFromManifest(filename: string): string {
  const rel = pathForFilename(filename)
  if (!rel) throw new Error(`non-canonical: ${filename}`)
  return join(testDir, rel)
}

function seedAsset(filename: string, taskId: string, type = 'images'): { rel: string; abs: string; ino: number } {
  const rel = pathForFilename(filename)
  if (!rel) throw new Error(`non-canonical: ${filename}`)
  const abs = join(testDir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, `bytes-for-${filename}`)
  writeFileSync(`${abs}.meta.json`, JSON.stringify({
    agent: 'test',
    taskId,
    type,
    created: new Date().toISOString(),
  }, null, 2))
  return { rel, abs, ino: statSync(abs).ino }
}

describe('filename identity — incident regression', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(assetsRoot, { recursive: true })
  })

  it('manifest reference survives retype — file at resolved path, same inode', () => {
    // Manifest holds only the filename. Everything else is derived.
    const filename = '20260404-hero-a1b2c3d4.png'
    const manifest = { taskId: 'task-64aabe60', asset: filename }

    const seeded = seedAsset(filename, manifest.taskId, 'images')

    // Agent reclassifies the asset in the UI — the exact action that
    // broke ff335816 under the old model.
    const result = retypeAsset({ filename, newType: 'research' })
    expect(result.ok).toBe(true)

    // The manifest reference resolves to the SAME live file.
    const resolved = resolveFromManifest(manifest.asset)
    expect(existsSync(resolved)).toBe(true)
    expect(statSync(resolved).ino).toBe(seeded.ino)

    // And the sidecar's type reflects the edit.
    const sidecar = JSON.parse(readFileSync(resolved + '.meta.json', 'utf-8'))
    expect(sidecar.type).toBe('research')
  })

  it('manifest reference survives relink to a different task', () => {
    const filename = '20260404-brief-b2c3d4e5.md'
    const manifest = { taskId: 'task-original', asset: filename }

    const seeded = seedAsset(filename, manifest.taskId, 'text')

    const result = relinkAsset({ filename, newTaskId: 'task-reassigned' })
    expect(result.ok).toBe(true)

    const resolved = resolveFromManifest(manifest.asset)
    expect(existsSync(resolved)).toBe(true)
    expect(statSync(resolved).ino).toBe(seeded.ino)
  })

  it('manifest reference survives unlink (relink → null)', () => {
    const filename = '20260404-unlinked-c3d4e5f6.md'
    const seeded = seedAsset(filename, 'task-x', 'text')

    const result = relinkAsset({ filename, newTaskId: null })
    expect(result.ok).toBe(true)

    const resolved = resolveFromManifest(filename)
    expect(existsSync(resolved)).toBe(true)
    expect(statSync(resolved).ino).toBe(seeded.ino)
  })

  it('manifest reference survives retype + relink + retype sequence', () => {
    const filename = '20260404-stress-d4e5f6a7.png'
    const seeded = seedAsset(filename, 'task-alpha', 'images')

    expect(retypeAsset({ filename, newType: 'research' }).ok).toBe(true)
    expect(relinkAsset({ filename, newTaskId: 'task-beta' }).ok).toBe(true)
    expect(retypeAsset({ filename, newType: 'plans' }).ok).toBe(true)

    const resolved = resolveFromManifest(filename)
    expect(existsSync(resolved)).toBe(true)
    expect(statSync(resolved).ino).toBe(seeded.ino)

    const sidecar = JSON.parse(readFileSync(resolved + '.meta.json', 'utf-8'))
    expect(sidecar.type).toBe('plans')
    expect(sidecar.taskId).toBe('task-beta')
  })

  it('restore from trash lands the file at the filename-derived path', () => {
    const filename = '20260404-round-e5f6a7b8.png'
    const seeded = seedAsset(filename, 'task-1', 'images')
    const expected = resolveFromManifest(filename)

    // Soft-delete then restore.
    expect(softDelete(seeded.abs, assetsRoot)).toBe(true)
    expect(existsSync(expected)).toBe(false)

    // The trash file carries the canonical name + a __deleted- suffix.
    // We only need the filename (manifest-style) to restore — the sidecar
    // taskId is irrelevant to the destination under filename-as-identity.
    const trashName = `${filename}__deleted-`
    // Find the actual trash entry (timestamp suffix).
    const { readdirSync } = require('fs') as typeof import('fs')
    const entry = readdirSync(join(assetsRoot, '.trash')).find((f: string) => f.startsWith(trashName) && !f.endsWith('.meta.json'))
    expect(entry, 'trash entry should exist').toBeTruthy()

    const restored = restoreAsset(entry!, assetsRoot)
    expect(restored).toBe(`assets/store/2026-04/${filename}`)

    // Manifest resolution works again after restore.
    expect(existsSync(expected)).toBe(true)
  })

  it('pathForFilename is the only path source — no mutation moves the file', () => {
    // Prove the property with a small fuzz: seed, mutate via every
    // metadata operation, and confirm pathForFilename always points
    // at the real file on disk.
    const filename = '20260404-fuzz-f6a7b8c9.png'
    seedAsset(filename, 'task-seed', 'images')

    const original = resolveFromManifest(filename)
    const originalIno = statSync(original).ino

    const mutations: Array<() => void> = [
      () => retypeAsset({ filename, newType: 'text' }),
      () => relinkAsset({ filename, newTaskId: 'task-a' }),
      () => retypeAsset({ filename, newType: 'data' }),
      () => relinkAsset({ filename, newTaskId: null }),
      () => retypeAsset({ filename, newType: 'images' }),
      () => relinkAsset({ filename, newTaskId: 'task-final' }),
    ]

    for (const mutate of mutations) {
      mutate()
      const resolved = resolveFromManifest(filename)
      expect(existsSync(resolved)).toBe(true)
      expect(statSync(resolved).ino).toBe(originalIno)
    }
  })
})
