/**
 * B2: resolveAssetServe — maps an /api/assets/<assetId>[...] path to a file on
 * disk. Built against a hand-constructed asset dir (deterministic, no ffmpeg).
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-serve-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { writeManifestAtomic, type AssetManifest } from '../../../plugins/assets/lib/manifest'
import { resolveAssetServe } from '../../../plugins/assets/lib/serve'

const assetId = '20260529-cake-aabbccdd'
const ym = '2026-05'
const dir = join(testDir, 'assets', 'store', ym, assetId)

const manifest: AssetManifest = {
  assetId, type: 'images', source: { kind: 'generated', path: null },
  agent: 'pixel', taskId: 't1', created: 'c', updated: 'c', currentVersion: 2,
  description: 'cake', tags: ['x'],
  versions: [
    { version: 1, file: 'v1.png', thumb: null, mimeType: 'image/png', size: 3, width: 4, height: 4, created: 'c', description: 'p1', op: 'generate', parentVersion: null, tool: 't', prompt: 'p1', promptHash: 'h1', generation: null },
    { version: 2, file: 'v2.png', thumb: 'v2.thumb.jpg', mimeType: 'image/png', size: 3, width: 4, height: 4, created: 'c', description: 'p2', op: 'edit', parentVersion: 1, tool: 't', prompt: 'p2', promptHash: 'h2', generation: null },
  ],
  exports: [
    { name: 'open-graph', surface: 'open-graph', format: 'jpg', file: 'exports/open-graph.jpg', width: 1200, height: 630, fromVersion: 2, created: 'c' },
  ],
}

beforeAll(() => {
  mkdirSync(join(dir, 'exports'), { recursive: true })
  writeFileSync(join(dir, 'v1.png'), 'AAA')
  writeFileSync(join(dir, 'v2.png'), 'BBB')
  writeFileSync(join(dir, 'v2.thumb.jpg'), 'TTT')
  writeFileSync(join(dir, 'exports', 'open-graph.jpg'), 'EEE')
  writeManifestAtomic(dir, manifest)
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('resolveAssetServe', () => {
  it('serves the current version for a bare assetId', () => {
    const r = resolveAssetServe([assetId])
    expect(r).toMatchObject({ match: true, found: true, mimeType: 'image/png', cacheKey: `${assetId}:v2` })
    expect(r).toHaveProperty('absPath', join(dir, 'v2.png'))
  })

  it('serves a specific version', () => {
    expect(resolveAssetServe([assetId, 'v', '1'])).toMatchObject({ found: true, absPath: join(dir, 'v1.png'), cacheKey: `${assetId}:v1` })
  })

  it('serves the current thumbnail', () => {
    expect(resolveAssetServe([assetId, 'thumb'])).toMatchObject({ found: true, absPath: join(dir, 'v2.thumb.jpg'), mimeType: 'image/jpeg' })
  })

  it('404s a thumbnail the version does not have', () => {
    expect(resolveAssetServe([assetId, 'v', '1', 'thumb'])).toEqual({ match: true, found: false })
  })

  it('serves an export by name', () => {
    expect(resolveAssetServe([assetId, 'export', 'open-graph'])).toMatchObject({ found: true, absPath: join(dir, 'exports', 'open-graph.jpg'), mimeType: 'image/jpeg' })
  })

  it('404s within the asset scheme for unknown asset / version / export', () => {
    expect(resolveAssetServe(['20260529-ghost-deadbeef'])).toEqual({ match: true, found: false })
    expect(resolveAssetServe([assetId, 'v', '99'])).toEqual({ match: true, found: false })
    expect(resolveAssetServe([assetId, 'export', 'nope'])).toEqual({ match: true, found: false })
  })

  it('does not match (falls back to filename scheme) for a filename or junk', () => {
    expect(resolveAssetServe(['20260529-cake-aabbccdd.png'])).toEqual({ match: false }) // has extension
    expect(resolveAssetServe(['some-file.jpg'])).toEqual({ match: false })
    expect(resolveAssetServe([])).toEqual({ match: false })
  })
})
