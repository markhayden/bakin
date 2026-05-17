/**
 * Assets-plugin-owned doctor check.
 *
 * Migrated out of src/core/doctor.ts (#139 C3). Behavioral coverage for
 * checkAssets — store shape, sidecar pairing (missing / orphan /
 * misnamed), disk-usage warning, and trash retention.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-assets-health-${Date.now()}-${randomUUID()}`)

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from 'fs'
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

let mockAutoFix = false
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { autoFixSkill: mockAutoFix } }),
  resetSettingsCache: () => {},
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
  mockAutoFix = false
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

/**
 * Seed the filename-as-identity assets tree so individual tests focus on the
 * specific signals they care about.
 */
function seedFullAssetsTree() {
  mkdirSync(storeDir, { recursive: true })
  mkdirSync(join(assetsRoot, 'inbox'), { recursive: true })
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
}

// ─── Empty / missing tree ─────────────────────────────────────────────────

describe('checkAssets — store shape', () => {
  it('warns when assets/ directory does not exist (no autoFix)', () => {
    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('assets/ directory not found') && r.autoFixable)).toBe(true)
  })

  it('repairs the assets/ tree explicitly', async () => {
    const results = checkAssets(testDir)
    const repair = assetRepair(testDir)
    const plan = await repair.plan(results)
    expect(plan).toHaveLength(1)
    const applied = await repair.apply(plan)
    expect(existsSync(assetsRoot)).toBe(true)
    expect(existsSync(join(assetsRoot, 'store'))).toBe(true)
    expect(existsSync(join(assetsRoot, 'inbox'))).toBe(true)
    expect(existsSync(join(assetsRoot, '.trash'))).toBe(true)
    expect(applied[0].status).toBe('applied')
    expect(applied[0].changes.some(change => change.description.includes('Created assets/ directory'))).toBe(true)
  })

  it('warns about missing required store directories without autoFix when assets/ exists', () => {
    mkdirSync(assetsRoot, { recursive: true })
    const results = checkAssets(testDir)
    expect(results.filter(r => r.status === 'warn' && r.message.includes('Missing assets/'))).toHaveLength(3)
  })

  it('reports ok when the tree is fully populated and clean', () => {
    seedFullAssetsTree()
    const results = checkAssets(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/0 asset\(s\), all sidecars present/)
  })

  it('warns about legacy top-level type directories instead of scanning them', () => {
    seedFullAssetsTree()
    const legacyDir = join(assetsRoot, 'images', 'task-abc')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'hero.png'), 'fake-image')

    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('Unexpected assets/images/'))).toBe(true)
    expect(results.some(r => r.message.includes('missing .meta.json'))).toBe(false)
  })
})

// ─── Missing sidecars ─────────────────────────────────────────────────────

describe('checkAssets — missing sidecars', () => {
  it('warns when an asset has no .meta.json (no autoFix)', () => {
    seedFullAssetsTree()
    writeFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png'), 'fake-image')

    const results = checkAssets(testDir)
    const sidecarWarn = results.find(r => r.status === 'warn' && r.message.includes('missing .meta.json sidecar'))
    expect(sidecarWarn).toBeDefined()
    expect(sidecarWarn!.autoFixable).toBe(true)
  })

  it('does not create stub sidecars during diagnostics even when legacy autoFix setting is true', () => {
    mockAutoFix = true
    seedFullAssetsTree()
    writeFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png'), 'fake-image')

    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('missing .meta.json sidecar'))).toBe(true)
    expect(existsSync(join(storeDir, '20260323-hero-a1b2c3d4.png.meta.json'))).toBe(false)
  })

  it('creates stub sidecars through explicit repair', async () => {
    seedFullAssetsTree()
    writeFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png'), 'fake-image')

    const results = checkAssets(testDir)
    const applied = await assetRepair(testDir).apply(await assetRepair(testDir).plan(results))
    expect(existsSync(join(storeDir, '20260323-hero-a1b2c3d4.png.meta.json'))).toBe(true)
    const stub = JSON.parse(readFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png.meta.json'), 'utf-8'))
    expect(stub.agent).toBe('unknown')
    expect(stub.taskId).toBeNull()
    expect(stub.type).toBe('images')
    expect(applied[0].changes.some(change => change.description.includes('Created 1 stub sidecar'))).toBe(true)
  })

  it('warns about non-canonical asset filenames in the store', () => {
    seedFullAssetsTree()
    writeFileSync(join(storeDir, 'hero.png'), 'fake-image')

    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('Non-canonical asset filename'))).toBe(true)
  })
})

// ─── Mismatched sidecars ──────────────────────────────────────────────────

describe('checkAssets — mismatched sidecars', () => {
  it('detects misnamed sidecar without autoFix', () => {
    seedFullAssetsTree()
    writeFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png'), 'fake-image')
    // Misnamed: uses base "hero" rather than full filename
    writeFileSync(
      join(storeDir, 'hero.meta.json'),
      JSON.stringify({ author: 'pixel', taskId: 'task-abc', createdAt: '2026-03-23T14:00:00Z' }),
    )

    const results = checkAssets(testDir)
    const warns = results.filter(r => r.status === 'warn')
    expect(warns.some(r => r.message.includes('misnamed') || r.message.includes('missing'))).toBe(true)
  })

  it('merges misnamed sidecar into the correctly-named stub through explicit repair, normalizing field names', async () => {
    seedFullAssetsTree()
    writeFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png'), 'fake-image')

    // Pre-existing stub at the correct path (agent: "unknown")
    writeFileSync(
      join(storeDir, '20260323-hero-a1b2c3d4.png.meta.json'),
      JSON.stringify({
        agent: 'unknown',
        taskId: 'task-abc',
        created: '2026-03-23T00:00:00Z',
        description: 'Auto-generated sidecar',
        tags: [],
      }, null, 2),
    )

    // Rich misnamed sidecar with legacy field names
    writeFileSync(
      join(storeDir, 'hero.meta.json'),
      JSON.stringify({
        author: 'pixel',
        taskId: 'task-abc',
        createdAt: '2026-03-23T14:00:00Z',
        tool: 'dall-e-3',
        description: 'A hero',
      }),
    )

    const results = checkAssets(testDir)
    const applied = await assetRepair(testDir).apply(await assetRepair(testDir).plan(results))
    expect(applied[0].changes.some(change => change.description.includes('Merged') || change.description.includes('misnamed'))).toBe(true)

    const merged = JSON.parse(readFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png.meta.json'), 'utf-8'))
    expect(merged.agent).toBe('pixel')           // normalized from author
    expect(merged.created).toBe('2026-03-23T14:00:00Z')  // normalized from createdAt
    expect(merged.tool).toBe('dall-e-3')
    expect(existsSync(join(storeDir, 'hero.meta.json'))).toBe(false)  // mismatched removed
  })

  it('removes the misnamed sidecar through explicit repair when the correctly-named one already has real content', async () => {
    seedFullAssetsTree()
    writeFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png'), 'fake-image')

    // Real (non-stub) sidecar at the correct path
    const realMeta = {
      agent: 'pixel',
      taskId: 'task-abc',
      created: '2026-03-23T15:00:00Z',
      description: 'Real',
    }
    writeFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png.meta.json'), JSON.stringify(realMeta, null, 2))

    // Misnamed orphan
    writeFileSync(join(storeDir, 'hero.meta.json'), JSON.stringify({ author: 'someone-else' }))

    const results = checkAssets(testDir)
    await assetRepair(testDir).apply(await assetRepair(testDir).plan(results))

    // Real sidecar untouched, mismatched removed
    expect(JSON.parse(readFileSync(join(storeDir, '20260323-hero-a1b2c3d4.png.meta.json'), 'utf-8'))).toEqual(realMeta)
    expect(existsSync(join(storeDir, 'hero.meta.json'))).toBe(false)
  })
})

// ─── Truly orphaned meta files ────────────────────────────────────────────

describe('checkAssets — orphaned meta', () => {
  it('warns about a .meta.json with no associated asset and no near-match', () => {
    seedFullAssetsTree()
    writeFileSync(
      join(storeDir, 'totally-unrelated.meta.json'),
      JSON.stringify({ agent: 'pixel', taskId: 'task-abc', created: '2026-03-23T00:00:00Z' }),
    )

    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('orphaned .meta.json'))).toBe(true)
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
    // Backdate ancient.bin to 30 days ago
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    utimesSync(oldFile, thirtyDaysAgo / 1000, thirtyDaysAgo / 1000)

    const results = checkAssets(testDir)
    const applied = await assetRepair(testDir).apply(await assetRepair(testDir).plan(results))
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
    expect(applied[0].changes.some(change => change.description.includes('Purged 1 expired'))).toBe(true)
  })

  it('does not purge trash items without autoFix', () => {
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
    // Write a sparse 6 GB file via fs.truncateSync — fast on macOS APFS
    const bigFile = join(storeDir, '20260323-huge-a1b2c3d4.bin')
    writeFileSync(bigFile, '')
    truncateSync(bigFile, 6 * 1024 * 1024 * 1024)
    // Sanity: file is reported as 6 GB
    expect(statSync(bigFile).size).toBe(6 * 1024 * 1024 * 1024)
    // Pair sidecar so it doesn't trip the missing-meta path
    writeFileSync(
      join(storeDir, '20260323-huge-a1b2c3d4.bin.meta.json'),
      JSON.stringify({ agent: 'pixel', taskId: 'task-abc', created: '2026-03-23T00:00:00Z' }),
    )

    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('GB — consider cleanup'))).toBe(true)
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────

describe('plugin registration', () => {
  it('registers the assets health check on activate', async () => {
    const assetsPlugin = (await import('../../../plugins/assets')).default
    const registeredIds: string[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'assets',
      registerRoute: noop, registerExecTool: noop, registerNav: noop,
      registerSlot: noop, registerSkill: noop, registerWorkflow: noop,
      registerNodeType: noop, registerNotificationChannel: noop,
      registerHealthCheck: (def: { id: string }) => { registeredIds.push(def.id); return `assets.${def.id}` },
      watchFiles: noop,
      getSettings: () => ({}),
      updateSettings: noop,
      activity: { log: noop, audit: noop },
      hooks: { register: () => () => {}, has: () => false, invoke: noopAsync },
      search: {
        registerContentType: noop, registerFileBackedContentType: noop,
        index: noopAsync, remove: noopAsync, transform: noopAsync,
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    await assetsPlugin.activate(ctx as unknown as Parameters<typeof assetsPlugin.activate>[0])

    expect(registeredIds).toContain('assets')
  })
})
