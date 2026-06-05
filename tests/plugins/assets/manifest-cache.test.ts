/**
 * Manifest read cache (#392): parse-count proofs, freshness without watcher
 * events, the ino discriminator for same-mtime writes, eviction, and the
 * test-mode freeze. Isolated to a temp BAKIN_HOME so it never touches ~/.bakin.
 *
 * RED-first: specs marked `it.skip` encode the cached behavior and fail on
 * pre-cache code — they are unskipped in the commit that lands the cache.
 * Unskipped specs pin current behavior the cache must not regress.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-manifest-cache-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll, beforeEach, spyOn, mock } from 'bun:test'
import * as fs from 'node:fs'

// Belt-and-braces isolation per CLAUDE.md: env vars above cover module-load
// reads; these mocks pin every content-dir resolution to the temp dir.
const bakinPaths = () => {
  const assets = join(testDir, 'assets')
  return {
    home: testDir, memoryLog: join(testDir, 'MEMORY-LOG.md'), audit: join(testDir, 'audit.jsonl'),
    assets, 'assets.store': join(assets, 'store'), 'assets.inbox': join(assets, 'inbox'), 'assets.trash': join(assets, '.trash'),
    agents: join(testDir, 'agents'), personas: join(testDir, 'team', 'personas'), team: join(testDir, 'team'),
    heartbeats: join(testDir, 'heartbeats'), inbox: join(testDir, 'inbox'), tasks: join(testDir, 'tasks'),
    workflows: join(testDir, 'workflows'), settings: join(testDir, 'settings.json'), logs: join(testDir, 'logs'),
  }
}
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: bakinPaths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: bakinPaths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
import { assetDirRelPath } from '../../../plugins/assets/lib/asset-id'
import { writeManifestAtomic, type AssetManifest } from '../../../plugins/assets/lib/manifest'
import { __resetManifestCache } from '../../../plugins/assets/lib/manifest-cache'
import {
  createAsset, getAsset, listAssets, addVersion, promoteVersion, relink,
  deleteAsset, restoreAsset, findBySourcePath,
} from '../../../plugins/assets/lib/asset-service'
import { resolveAssetServe } from '../../../plugins/assets/lib/serve'

const srcDir = join(testDir, 'src')

/** Count readFileSync calls that target a manifest.json. */
function manifestReads(spy: ReturnType<typeof spyOn>): number {
  return spy.mock.calls.filter((c) => String(c[0]).endsWith('manifest.json')).length
}

function makeSource(name: string, content: string): string {
  const p = join(srcDir, name)
  writeFileSync(p, content, 'utf-8')
  return p
}

async function makeAsset(name: string, content: string, taskId: string | null = null): Promise<string> {
  const { assetId } = await createAsset({
    sourceFilePath: makeSource(name, content), type: 'text', agent: 'tester', taskId,
  })
  return assetId
}

beforeAll(() => mkdirSync(srcDir, { recursive: true }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => __resetManifestCache())

describe('parse counts (cache hits read zero manifests)', () => {
  // RED: unskip in the commit that lands the cache (#392)
  it.skip('listAssets parses each manifest once, then zero on unchanged repeat calls', async () => {
    const ids = [await makeAsset('a.md', 'a'), await makeAsset('b.md', 'b'), await makeAsset('c.md', 'c')]
    __resetManifestCache()

    const spy = spyOn(fs, 'readFileSync')
    spy.mockClear()
    const first = listAssets()
    expect(first.map((s) => s.assetId).sort()).toEqual([...ids].sort())
    expect(manifestReads(spy)).toBe(ids.length)

    spy.mockClear()
    const second = listAssets()
    expect(second).toEqual(first)
    expect(manifestReads(spy)).toBe(0)
    spy.mockRestore()
  })

  // RED: unskip in the commit that lands the cache (#392)
  it.skip('serve resolves with at most one parse cold and zero warm', async () => {
    const id = await makeAsset('serve.md', 'serve me')
    __resetManifestCache()

    const spy = spyOn(fs, 'readFileSync')
    spy.mockClear()
    const cold = resolveAssetServe([id])
    expect(cold).toMatchObject({ match: true, found: true })
    expect(manifestReads(spy)).toBeLessThanOrEqual(1)

    spy.mockClear()
    const warm = resolveAssetServe([id])
    expect(warm).toEqual(cold)
    expect(manifestReads(spy)).toBe(0)
    spy.mockRestore()
  })

  // RED: unskip in the commit that lands the cache (#392)
  it.skip('findBySourcePath parses nothing on a warm cache', async () => {
    const src = makeSource('find-me.md', 'find')
    const { assetId } = await createAsset({ sourceFilePath: src, type: 'text', agent: 'tester', taskId: null })
    __resetManifestCache()
    listAssets() // warm

    const spy = spyOn(fs, 'readFileSync')
    spy.mockClear()
    expect(findBySourcePath(src)).toBeNull() // created via upload source (path null)
    expect(getAsset(assetId)?.assetId).toBe(assetId)
    expect(manifestReads(spy)).toBe(0)
    spy.mockRestore()
  })
})

describe('freshness without watcher events', () => {
  it('every mutation path is immediately visible through reads', async () => {
    const id = await makeAsset('mut.md', 'v1 content', 'task-1')
    listAssets() // warm cache

    await addVersion(id, { sourceFilePath: makeSource('mut-v2.md', 'v2 content') })
    expect(getAsset(id)?.versions.length).toBe(2)
    expect(getAsset(id)?.currentVersion).toBe(2)

    await promoteVersion(id, 1)
    expect(getAsset(id)?.currentVersion).toBe(1)
    expect(listAssets().find((s) => s.assetId === id)?.currentVersion).toBe(1)

    await relink(id, 'task-2')
    expect(getAsset(id)?.taskId).toBe('task-2')

    const { trashName } = await deleteAsset(id)
    expect(getAsset(id)).toBeNull()
    expect(listAssets().some((s) => s.assetId === id)).toBe(false)

    await restoreAsset(trashName)
    expect(getAsset(id)?.taskId).toBe('task-2')
    expect(listAssets().some((s) => s.assetId === id)).toBe(true)
  })

  it('an external manifest rewrite is immediately visible (no watcher running)', async () => {
    const id = await makeAsset('ext.md', 'original')
    const manifest = getAsset(id)! // warm the cache with the original
    const dirAbs = join(testDir, assetDirRelPath(id)!)

    const edited: AssetManifest = JSON.parse(JSON.stringify(manifest))
    edited.description = 'hand-edited externally'
    writeManifestAtomic(dirAbs, edited)

    expect(getAsset(id)?.description).toBe('hand-edited externally')
  })

  it('observes a second write even when forced to the identical mtime (ino discriminates)', async () => {
    const id = await makeAsset('mtime.md', 'first')
    const dirAbs = join(testDir, assetDirRelPath(id)!)
    const manifestPath = join(dirAbs, 'manifest.json')

    const before = getAsset(id)! // fill cache
    const st = statSync(manifestPath)

    const edited: AssetManifest = JSON.parse(JSON.stringify(before))
    edited.description = 'second write, same mtime'
    writeManifestAtomic(dirAbs, edited)
    // Force the new file back to the exact pre-write timestamps: only the
    // inode (fresh temp file per atomic write) can tell the versions apart.
    utimesSync(manifestPath, st.atime, st.mtime)

    expect(getAsset(id)?.description).toBe('second write, same mtime')
  })
})

describe('eviction + negative reads', () => {
  it('never caches a negative: a miss followed by creation is immediately visible', async () => {
    const ghostId = '20260101-ghost-aabbccdd'
    expect(getAsset(ghostId)).toBeNull()
    expect(getAsset(ghostId)).toBeNull() // repeat miss, still null, no crash

    // Materialize the exact id that just missed; it must appear immediately.
    const dirAbs = join(testDir, assetDirRelPath(ghostId)!)
    mkdirSync(dirAbs, { recursive: true })
    const manifest: AssetManifest = {
      assetId: ghostId, type: 'text', source: { kind: 'upload', path: null },
      agent: 'tester', taskId: null, created: 'c', updated: 'c', currentVersion: 1,
      description: 'now real', tags: [],
      versions: [{ version: 1, file: 'v1.md', thumb: null, mimeType: 'text/markdown', size: 1, width: null, height: null, created: 'c', description: 'now real', tags: [], op: 'upload', parentVersion: null, tool: null, prompt: null, promptHash: null, generation: null }],
      exports: [],
    }
    writeFileSync(join(dirAbs, 'v1.md'), 'x', 'utf-8')
    writeManifestAtomic(dirAbs, manifest)

    expect(getAsset(ghostId)?.description).toBe('now real')
  })

  it('a trashed asset reads null immediately (entry evicted, not stale)', async () => {
    const id = await makeAsset('evict.md', 'soon gone')
    getAsset(id) // warm
    await deleteAsset(id)
    expect(getAsset(id)).toBeNull()
    expect(resolveAssetServe([id])).toMatchObject({ match: true, found: false })
  })
})

describe('test-mode freeze', () => {
  // RED: unskip in the commit that lands the cache (#392)
  it.skip('cached manifests are frozen under NODE_ENV=test — consumer mutation throws', async () => {
    const id = await makeAsset('frozen.md', 'do not touch')
    const manifest = getAsset(id)!
    expect(() => { (manifest as AssetManifest).description = 'mutated' }).toThrow()
    expect(() => { (manifest as AssetManifest).versions[0].tags.push('nope') }).toThrow()
    expect(getAsset(id)?.description).toBe('do not touch')
  })
})
