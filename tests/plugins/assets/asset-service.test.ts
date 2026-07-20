/**
 * Versioned asset service foundation (B1): assetId, per-asset lock, atomic
 * manifest IO, and create/read service. Isolated to a temp BAKIN_HOME so it
 * never touches ~/.bakin.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-asset-svc-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'

// Belt-and-braces alongside the BAKIN_HOME env isolation above (the env var
// is set before imports; these mocks make the isolation explicit).
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
import sharp from 'sharp'
import { generateAssetId, yearMonthFromAssetId, isValidAssetId, assetDirRelPath } from '../../../plugins/assets/lib/asset-id'
import { withAssetLock } from '../../../plugins/assets/lib/asset-lock'
import { readManifest, writeManifestAtomic, type AssetManifest } from '../../../plugins/assets/lib/manifest'
import { createAsset, getAsset, resolveFile, assetExists, listAssets, resolveStoreFile, upsertFromSource } from '../../../plugins/assets/lib/asset-service'
import { allocateRunWorkspace } from '../../../src/core/run-workspace'
import { claimRun, settleRun } from '../../../src/core/execution-ledger'
import { closeDb } from '../../../packages/core/src/storage/db'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const srcDir = join(testDir, 'src')

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'note.md'), '# hello\nworld\n', 'utf-8')
  await sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toFile(join(srcDir, 'pic.png'))
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('asset-id', () => {
  it('generates YYYYMMDD-slug-id8 and derives the shard', () => {
    const id = generateAssetId('Ice Cream Sandwich!')
    expect(id).toMatch(/^\d{8}-ice-cream-sandwich-[0-9a-f]{8}$/)
    expect(yearMonthFromAssetId(id)).toMatch(/^\d{4}-\d{2}$/)
    expect(assetDirRelPath(id)).toBe(`assets/store/${yearMonthFromAssetId(id)}/${id}`)
  })

  it('rejects unsafe / non-conforming ids', () => {
    expect(isValidAssetId('20260529-x-aabbccdd')).toBe(true)
    expect(isValidAssetId('../escape-aabbccdd')).toBe(false)
    expect(isValidAssetId('a/b-aabbccdd')).toBe(false)
    expect(isValidAssetId('not-an-id')).toBe(false)
    expect(yearMonthFromAssetId('20261301-x-aabbccdd')).toBeNull() // bad month
  })
})

describe('withAssetLock', () => {
  it('serializes operations on the same assetId', async () => {
    const order: string[] = []
    const op = (label: string, ms: number) =>
      withAssetLock('a', async () => { order.push(`${label}-start`); await delay(ms); order.push(`${label}-end`) })
    await Promise.all([op('1', 25), op('2', 5)])
    expect(order).toEqual(['1-start', '1-end', '2-start', '2-end'])
  })

  it('allows operations on different assetIds to overlap', async () => {
    const order: string[] = []
    const op = (id: string, label: string, ms: number) =>
      withAssetLock(id, async () => { order.push(`${label}-start`); await delay(ms); order.push(`${label}-end`) })
    await Promise.all([op('x', 'x', 25), op('y', 'y', 5)])
    // y must start before x finishes — proving concurrency across ids
    expect(order.indexOf('y-start')).toBeLessThan(order.indexOf('x-end'))
  })
})

describe('manifest atomic IO', () => {
  const dir = join(testDir, 'mtest')
  const manifest: AssetManifest = {
    assetId: '20260529-m-aabbccdd', type: 'text', source: { kind: 'upload', path: null },
    agent: 'tester', taskId: null, created: 'c', updated: 'c', currentVersion: 1,
    description: 'd', tags: ['t'],
    versions: [{ version: 1, file: 'v1.md', thumb: null, mimeType: 'text/markdown', size: 3, width: null, height: null, created: 'c', description: 'd', op: 'upload', parentVersion: null, tool: null, prompt: null, promptHash: null, generation: null }],
    exports: [],
  }

  beforeAll(() => mkdirSync(dir, { recursive: true }))

  it('round-trips and leaves no temp files', () => {
    writeManifestAtomic(dir, manifest)
    expect(readManifest(dir)).toEqual(manifest)
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('returns null for a missing or invalid manifest', () => {
    expect(readManifest(join(testDir, 'nope'))).toBeNull()
    const bad = join(testDir, 'bad'); mkdirSync(bad, { recursive: true })
    writeFileSync(join(bad, 'manifest.json'), '{ not valid', 'utf-8')
    expect(readManifest(bad)).toBeNull()
  })
})

describe('asset-service create + read', () => {
  it('creates a text asset (v1) and reads it back', async () => {
    const { assetId, version, manifest } = await createAsset({
      sourceFilePath: join(srcDir, 'note.md'), type: 'text', agent: 'tester', taskId: 'task-1',
      slug: 'my note', op: 'upload', description: 'a note',
    })
    expect(version).toBe(1)
    expect(manifest.currentVersion).toBe(1)
    expect(manifest.versions[0].file).toBe('v1.md')
    const dirAbs = join(testDir, assetDirRelPath(assetId)!)
    expect(existsSync(join(dirAbs, 'v1.md'))).toBe(true)
    expect(existsSync(join(dirAbs, 'manifest.json'))).toBe(true)
    expect(getAsset(assetId)?.assetId).toBe(assetId)
    expect(assetExists(assetId)).toBe(true)
    expect(assetExists('20260529-ghost-deadbeef')).toBe(false)
  })

  it('creates an image asset with probed dimensions', async () => {
    const { assetId, manifest } = await createAsset({
      sourceFilePath: join(srcDir, 'pic.png'), type: 'images', agent: 'pixel', taskId: 'task-2',
      slug: 'pic', op: 'generate',
    })
    expect(manifest.versions[0].mimeType).toBe('image/png')
    expect(manifest.versions[0].width).toBe(8)
    expect(manifest.versions[0].height).toBe(6)
    expect(manifest.versions[0].thumb).toBe('v1.thumb.jpg')
    const ref = resolveFile(assetId)
    expect(ref?.version).toBe(1)
    expect(ref?.absPath.endsWith('v1.png')).toBe(true)
    expect(existsSync(join(testDir, assetDirRelPath(assetId)!, 'v1.thumb.jpg'))).toBe(true)
    expect(resolveFile(assetId, 99)).toBeNull()
  })

  it('lists assets with current-version view and filters', async () => {
    const all = listAssets()
    expect(all.length).toBeGreaterThanOrEqual(2)
    expect(all.every((a) => a.versionCount === 1)).toBe(true)
    expect(listAssets({ type: 'images' }).every((a) => a.type === 'images')).toBe(true)
    expect(listAssets({ taskId: 'task-1' }).every((a) => a.taskId === 'task-1')).toBe(true)
  })

  it('filters by tag with AND semantics (the UI "folders", #418)', async () => {
    await createAsset({
      sourceFilePath: join(srcDir, 'pic.png'), type: 'images', agent: 'pixel', taskId: 'task-brand',
      slug: 'brand-hero', op: 'generate', tags: ['Brand', 'hero'],
    })
    // Single tag, normalized (Brand → brand).
    const brand = listAssets({ tags: ['brand'] })
    expect(brand.length).toBe(1)
    expect(brand[0].tags).toEqual(expect.arrayContaining(['brand', 'hero']))
    // AND: must carry every requested tag.
    expect(listAssets({ tags: ['brand', 'hero'] }).length).toBe(1)
    expect(listAssets({ tags: ['brand', 'missing'] }).length).toBe(0)
  })
})

describe('run-workspace saves: task-stable identity + staleness gate (same-agent-concurrency D2)', () => {
  const boot = 'boot-asset-test'

  function liveRun(taskId: string, seq: number): string {
    const runId = `task:${taskId}:d${seq}`
    claimRun({ runId, taskId, seq, agent: 'jessica', bootId: boot, now: Date.now() })
    return runId
  }

  it('re-save across attempts versions ONE asset (virtual dedup key), live runs advance current', async () => {
    const d1 = liveRun('rw-task', 1)
    const dirA = allocateRunWorkspace({ threadId: d1, taskId: 'rw-task', agentId: 'jessica' })
    writeFileSync(join(dirA, 'report.md'), 'draft one', 'utf-8')
    const first = await upsertFromSource(join(dirA, 'report.md'), {
      sourceFilePath: join(dirA, 'report.md'), type: 'text', agent: 'jessica', taskId: 'rw-task', op: 'upload', tool: null,
    })
    expect(first.changed).toBe(true)
    settleRun(d1, 'failed: died')

    // Corrective attempt d2: DIFFERENT run dir, same relative path.
    const d2 = liveRun('rw-task', 2)
    const dirB = allocateRunWorkspace({ threadId: d2, taskId: 'rw-task', agentId: 'jessica' })
    expect(dirB).not.toBe(dirA)
    writeFileSync(join(dirB, 'report.md'), 'draft two — corrected', 'utf-8')
    const second = await upsertFromSource(join(dirB, 'report.md'), {
      sourceFilePath: join(dirB, 'report.md'), type: 'text', agent: 'jessica', taskId: 'rw-task', op: 'upload', tool: null,
    })

    // One asset, two versions — never a duplicate per attempt.
    expect(second.assetId).toBe(first.assetId)
    expect(second.version).toBe(2)
    expect(second.staleSuppressed).toBeUndefined()
    const manifest = getAsset(first.assetId)
    expect(manifest?.currentVersion).toBe(2)
    expect(manifest?.source?.path).toBe('run:task:rw-task/report.md')
    settleRun(d2, 'ok')
  })

  it('a save from a NO-LONGER-LIVE run records its version but never advances currentVersion', async () => {
    const d1 = liveRun('rw-stale', 1)
    const dir = allocateRunWorkspace({ threadId: d1, taskId: 'rw-stale', agentId: 'jessica' })
    writeFileSync(join(dir, 'out.md'), 'good output', 'utf-8')
    const first = await upsertFromSource(join(dir, 'out.md'), {
      sourceFilePath: join(dir, 'out.md'), type: 'text', agent: 'jessica', taskId: 'rw-stale', op: 'upload', tool: null,
    })
    // The run settles (zombie territory) — then its late save arrives.
    settleRun(d1, 'ok')
    writeFileSync(join(dir, 'out.md'), 'ZOMBIE overwrite', 'utf-8')
    const late = await upsertFromSource(join(dir, 'out.md'), {
      sourceFilePath: join(dir, 'out.md'), type: 'text', agent: 'jessica', taskId: 'rw-stale', op: 'upload', tool: null,
    })

    expect(late.assetId).toBe(first.assetId)
    expect(late.changed).toBe(true)
    expect(late.staleSuppressed).toBe(true)
    const manifest = getAsset(first.assetId)
    // Bytes recorded as v2, pointer still v1.
    expect(manifest?.versions.length).toBe(2)
    expect(manifest?.currentVersion).toBe(1)
  })

  it('a run path with NO sidecar degrades to real-path identity (never guesses linkage)', async () => {
    const orphanDir = join(testDir, 'run-workspaces', 'jessica', 'orphan-nolink')
    mkdirSync(orphanDir, { recursive: true })
    writeFileSync(join(orphanDir, 'thing.md'), 'orphan bytes', 'utf-8')
    const r = await upsertFromSource(join(orphanDir, 'thing.md'), {
      sourceFilePath: join(orphanDir, 'thing.md'), type: 'text', agent: 'jessica', taskId: 'rw-orphan', op: 'upload', tool: null,
    })
    expect(r.changed).toBe(true)
    expect(getAsset(r.assetId)?.source?.path).toBe(join(orphanDir, 'thing.md'))
  })
})

describe('store-path reflection + same-task content dedupe (penguin-test fixes)', () => {
  it('resolveStoreFile maps a store version file (and its thumb) back to assetId@version', async () => {
    const { assetId } = await createAsset({
      sourceFilePath: join(srcDir, 'pic.png'), type: 'images', agent: 'pixel', taskId: 'task-reflect',
      slug: 'reflect', op: 'import',
    })
    const dirAbs = join(testDir, assetDirRelPath(assetId)!)
    const hit = resolveStoreFile(join(dirAbs, 'v1.png'))
    expect(hit).toMatchObject({ assetId, version: 1 })
    expect(hit!.absPath.endsWith('v1.png')).toBe(true)
    // A thumb path resolves to the same version, with absPath = the REAL file.
    expect(resolveStoreFile(join(dirAbs, 'v1.thumb.jpg'))).toMatchObject({ assetId, version: 1 })
    expect(resolveStoreFile(join(dirAbs, 'v1.thumb.jpg'))!.absPath.endsWith('v1.png')).toBe(true)
    // Non-store paths and store-internal non-version files do not resolve.
    expect(resolveStoreFile(join(srcDir, 'pic.png'))).toBeNull()
    expect(resolveStoreFile(join(dirAbs, 'manifest.json'))).toBeNull()
  })

  it('upsertFromSource of a store-internal path returns the existing identity — never a duplicate', async () => {
    const { assetId } = await createAsset({
      sourceFilePath: join(srcDir, 'pic.png'), type: 'images', agent: 'pixel', taskId: 'task-noclone',
      slug: 'original', op: 'import',
    })
    const storePath = join(testDir, assetDirRelPath(assetId)!, 'v1.png')
    const before = listAssets().length

    const up = await upsertFromSource(storePath, {
      sourceFilePath: storePath, type: 'images', agent: 'pixel', taskId: 'task-noclone',
      op: 'import', description: 'v1.png', source: { kind: 'import', path: storePath },
    })

    expect(up).toMatchObject({ assetId, version: 1, changed: false })
    expect(listAssets().length).toBe(before)
  })

  it('upsertFromSource dedupes byte-identical content on the SAME task (new path, same bytes)', async () => {
    const original = await createAsset({
      sourceFilePath: join(srcDir, 'pic.png'), type: 'images', agent: 'pixel', taskId: 'task-bytes',
      slug: 'deliverable', op: 'generate',
    })
    // The agent copies the finished render to a fresh workspace path and re-saves it.
    const copyPath = join(srcDir, 'final-copy.png')
    writeFileSync(copyPath, readFileSync(join(testDir, assetDirRelPath(original.assetId)!, 'v1.png')))
    const before = listAssets().length

    const up = await upsertFromSource(copyPath, {
      sourceFilePath: copyPath, type: 'images', agent: 'pixel', taskId: 'task-bytes',
      op: 'upload', description: 'final copy', source: { kind: 'workspace-file', path: copyPath },
    })

    expect(up).toMatchObject({ assetId: original.assetId, version: 1, changed: false })
    expect(listAssets().length).toBe(before)
  })

  it('does NOT dedupe identical bytes across DIFFERENT tasks', async () => {
    const original = await createAsset({
      sourceFilePath: join(srcDir, 'pic.png'), type: 'images', agent: 'pixel', taskId: 'task-a',
      slug: 'a-img', op: 'generate',
    })
    const copyPath = join(srcDir, 'cross-task.png')
    writeFileSync(copyPath, readFileSync(join(testDir, assetDirRelPath(original.assetId)!, 'v1.png')))

    const up = await upsertFromSource(copyPath, {
      sourceFilePath: copyPath, type: 'images', agent: 'pixel', taskId: 'task-b',
      op: 'upload', description: 'reuse on another task', source: { kind: 'workspace-file', path: copyPath },
    })

    expect(up.assetId).not.toBe(original.assetId)
    expect(up.changed).toBe(true)
  })
})
