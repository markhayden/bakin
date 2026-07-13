/**
 * Assets-plugin-owned doctor check.
 *
 * Behavioral coverage for checkAssets — store shape, month-shard / entry
 * naming, disk-usage warning, trash retention, and versioned-asset manifest
 * integrity.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-assets-health-${Date.now()}-${randomUUID()}`)

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { assetRepair, checkAssets } from '../../../plugins/assets/lib/health-checks'

const assetsRoot = join(testDir, 'assets')
const storeRoot = join(assetsRoot, 'store')
const storeDir = join(storeRoot, '2026-03')

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function seedFullAssetsTree() {
  mkdirSync(storeDir, { recursive: true })
  mkdirSync(join(assetsRoot, 'inbox'), { recursive: true })
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
}

function observations(result = checkAssets(testDir)) {
  if (result.outcome !== 'observed') throw new Error(`Expected observed Assets health, got ${result.outcome}`)
  return result.observations
}

const repairTarget = { type: 'all_actionable' as const, reportId: 'test-report' }

/** Seed a valid versioned asset directory under the 2026-03 shard. */
function seedVersionedAsset(assetId: string, overrides?: { currentVersion?: number; files?: string[] }): string {
  const dir = join(storeDir, assetId)
  mkdirSync(dir, { recursive: true })
  const files = overrides?.files ?? ['v1.png']
  for (const f of files) writeFileSync(join(dir, f), 'bytes')
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    assetId, type: 'images', source: { kind: 'generated', path: null },
    agent: 'pixel', taskId: null, created: 'c', updated: 'c',
    currentVersion: overrides?.currentVersion ?? 1, description: '', tags: [],
    versions: [{
      version: 1, file: 'v1.png', thumb: null, mimeType: 'image/png', size: 5,
      width: null, height: null, created: 'c', description: '', tags: [],
      op: 'generate', parentVersion: null, tool: null, prompt: null, promptHash: null, generation: null,
    }],
    exports: [],
  }))
  return dir
}

// ─── Store shape ──────────────────────────────────────────────────────────

describe('checkAssets — store shape', () => {
  it('surfaces a repair action when the assets directory does not exist', () => {
    const results = observations()
    expect(results.some(r =>
      r.status === 'warning' &&
      r.summary.includes('assets directory is missing') &&
      r.incident.resolution.type === 'repair'
    )).toBe(true)
  })

  it('repairs the assets/ tree explicitly', async () => {
    const repair = assetRepair(testDir)
    const plan = await repair.plan(repairTarget)
    expect(plan).toHaveLength(1)
    const applied = await repair.apply(plan)
    expect(existsSync(assetsRoot)).toBe(true)
    expect(existsSync(join(assetsRoot, 'store'))).toBe(true)
    expect(existsSync(join(assetsRoot, 'inbox'))).toBe(true)
    expect(existsSync(join(assetsRoot, '.trash'))).toBe(true)
    expect(applied[0].status).toBe('applied')
    expect(applied[0].changes.some(change => change.description.includes('asset store root'))).toBe(true)
  })

  it('reports missing required store directories without mutating them', () => {
    mkdirSync(assetsRoot, { recursive: true })
    const results = observations()
    expect(results.filter(r => r.status === 'warning' && r.key.startsWith('directory-missing-'))).toHaveLength(3)
  })

  it('reports ok when the tree is empty and clean (incl. unimported + enrichment checks)', () => {
    seedFullAssetsTree()
    const results = observations()
    expect(results).toHaveLength(3)
    expect(results.every(r => r.status === 'healthy')).toBe(true)
    expect(results[0].summary).toMatch(/asset store is empty and healthy/i)
    expect(results[1].summary).toMatch(/No unmanaged files/)
    expect(results[2].summary).toMatch(/enrichment/)
  })

  it('surfaces an advisory when unmanaged files await import', () => {
    seedFullAssetsTree()
    mkdirSync(join(assetsRoot, 'inbox'), { recursive: true })
    writeFileSync(join(assetsRoot, 'inbox', 'dropped.png'), 'x')
    const results = observations()
    const unimported = results.find(r => r.key === 'unimported')!
    expect(unimported.status).toBe('warning')
    expect(unimported.summary).toContain('1 unmanaged file')
    expect(unimported.incident?.resolution.type).toBe('navigate')
  })

  it('warns about legacy top-level type directories instead of scanning them', () => {
    seedFullAssetsTree()
    const legacyDir = join(assetsRoot, 'images', 'task-abc')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'hero.png'), 'fake-image')

    const results = observations()
    expect(results.some(r => r.status === 'warning' && r.summary.includes('Unexpected assets/images'))).toBe(true)
  })

  it('warns about non-assetId entries inside a month shard', () => {
    seedFullAssetsTree()
    writeFileSync(join(storeDir, 'loose-file.png'), 'fake-image')

    const results = observations()
    expect(results.some(r => r.status === 'warning' && r.summary.includes('entries must be asset directories'))).toBe(true)
  })

  it('warns about non-canonical month shards', () => {
    seedFullAssetsTree()
    mkdirSync(join(storeRoot, 'not-a-shard'), { recursive: true })

    const results = observations()
    expect(results.some(r => r.status === 'warning' && r.summary.includes('canonical YYYY-MM shard'))).toBe(true)
  })
})

// ─── Versioned manifest integrity ──────────────────────────────────────────

describe('checkAssets — manifest integrity', () => {
  it('reports ok when all manifests are valid', () => {
    seedFullAssetsTree()
    seedVersionedAsset('20260323-hero-a1b2c3d4')
    seedVersionedAsset('20260323-banner-b2c3d4e5')

    const results = observations()
    expect(results.some(r => r.status === 'healthy' && r.summary.includes('2 versioned asset(s) have valid manifests'))).toBe(true)
  })

  it('warns about an asset directory with no manifest', () => {
    seedFullAssetsTree()
    mkdirSync(join(storeDir, '20260323-broken-c3d4e5f6'), { recursive: true })

    const results = observations()
    expect(results.some(r => r.status === 'warning' && r.summary.includes('missing or invalid manifest.json'))).toBe(true)
  })

  it('warns when currentVersion is not in versions[]', () => {
    seedFullAssetsTree()
    seedVersionedAsset('20260323-bad-d4e5f6a7', { currentVersion: 9 })

    const results = observations()
    expect(results.some(r => r.status === 'warning' && r.summary.includes('currentVersion 9 is absent from versions[]'))).toBe(true)
  })

  it('warns when a version file is missing on disk', () => {
    seedFullAssetsTree()
    // Manifest references v1.png but we write no version files.
    seedVersionedAsset('20260323-nofile-e5f6a7b8', { files: [] })

    const results = observations()
    expect(results.some(r => r.status === 'warning' && r.summary.includes('missing version file v1.png'))).toBe(true)
  })
})

// ─── Trash purge ──────────────────────────────────────────────────────────

describe('checkAssets — trash purge', () => {
  it('purges trash items older than 7 days through explicit repair', async () => {
    seedFullAssetsTree()
    const trashDir = join(assetsRoot, '.trash')
    const oldFile = join(trashDir, 'ancient.bin')
    const freshFile = join(trashDir, 'fresh.bin')
    writeFileSync(oldFile, 'old-bytes')
    writeFileSync(freshFile, 'fresh-bytes')
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    utimesSync(oldFile, thirtyDaysAgo / 1000, thirtyDaysAgo / 1000)

    const repair = assetRepair(testDir)
    const applied = await repair.apply(await repair.plan(repairTarget))
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
    expect(applied[0].changes.some(change => change.description.includes('Purge expired trash item'))).toBe(true)
  })

  it('does not purge trash items during diagnostics', () => {
    seedFullAssetsTree()
    const trashDir = join(assetsRoot, '.trash')
    const oldFile = join(trashDir, 'ancient.bin')
    writeFileSync(oldFile, 'old-bytes')
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    utimesSync(oldFile, thirtyDaysAgo / 1000, thirtyDaysAgo / 1000)

    checkAssets(testDir)
    expect(existsSync(oldFile)).toBe(true)
  })
})

// ─── Disk-usage warning (>5GB) ────────────────────────────────────────────

describe('checkAssets — disk usage', () => {
  it('warns when the assets tree exceeds 5GB', () => {
    seedFullAssetsTree()
    const dir = join(storeDir, '20260323-huge-a1b2c3d4')
    mkdirSync(dir, { recursive: true })
    const bigFile = join(dir, 'v1.bin')
    writeFileSync(bigFile, '')
    truncateSync(bigFile, 6 * 1024 * 1024 * 1024)
    expect(statSync(bigFile).size).toBe(6 * 1024 * 1024 * 1024)

    const results = observations()
    expect(results.some(r => r.status === 'warning' && r.summary.includes('GB'))).toBe(true)
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────

describe('plugin registration', () => {
  it('registers the assets health check on activate', async () => {
    const assetsPlugin = (await import('../../../plugins/assets')).default
    const registeredIds: string[] = []
    const registeredActionIds: string[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'assets',
      registerRoute: noop, registerExecTool: noop, registerNav: noop,
      registerSlot: noop, registerSkill: noop, registerWorkflow: noop,
      registerNodeType: noop, registerNotificationChannel: noop,
      registerHealthCheck: (def: { id: string }) => { registeredIds.push(def.id); return `assets.${def.id}` },
      registerHealthRepairAction: (def: { id: string }) => { registeredActionIds.push(def.id); return `assets.${def.id}` },
      watchFiles: noop,
      getSettings: () => ({}),
      updateSettings: noop,
      activity: { log: noop, audit: noop },
      hooks: { register: () => () => {}, has: () => false, invoke: noopAsync },
      search: {
        registerContentType: noop, registerFileBackedContentType: noop,
        index: noopAsync, remove: noopAsync, transform: noopAsync,
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } })),
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    await assetsPlugin.activate(ctx as unknown as Parameters<typeof assetsPlugin.activate>[0])

    expect(registeredIds).toContain('assets')
    expect(registeredActionIds).toContain('repair-store')
  })
})
