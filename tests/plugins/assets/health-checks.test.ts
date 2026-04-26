/**
 * Assets-plugin-owned doctor check.
 *
 * Migrated out of src/core/doctor.ts (#139 C3). Behavioral coverage for
 * checkAssets — directory shape, sidecar pairing (missing / orphan /
 * misnamed), disk-usage warning, and trash retention.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-assets-health-${Date.now()}-${randomUUID()}`)

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'

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

let mockAutoFix = false
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { autoFixSkill: mockAutoFix } }),
  resetSettingsCache: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { checkAssets } from '../../../plugins/assets/lib/health-checks'

const assetsRoot = join(testDir, 'assets')
const imagesDir = join(assetsRoot, 'images')

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockAutoFix = false
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

/**
 * Seed every asset-type subdir + .trash so individual tests focus on the
 * specific signals they care about. Tests that exercise the missing-dir
 * fix path call `seedNothing()` instead.
 */
function seedFullAssetsTree() {
  const types = ['text', 'images', 'video', 'audio', 'plans', 'data', 'other']
  for (const t of types) {
    mkdirSync(join(assetsRoot, t, '_unlinked'), { recursive: true })
    mkdirSync(join(assetsRoot, t, 'library'), { recursive: true })
  }
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
}

// ─── Empty / missing tree ─────────────────────────────────────────────────

describe('checkAssets — directory shape', () => {
  it('warns when assets/ directory does not exist (no autoFix)', () => {
    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('assets/ directory not found') && r.autoFixable)).toBe(true)
  })

  it('creates the assets/ tree under autoFix', () => {
    mockAutoFix = true
    const results = checkAssets(testDir)
    expect(existsSync(assetsRoot)).toBe(true)
    expect(existsSync(join(assetsRoot, 'images', '_unlinked'))).toBe(true)
    expect(existsSync(join(assetsRoot, 'images', 'library'))).toBe(true)
    expect(existsSync(join(assetsRoot, '.trash'))).toBe(true)
    expect(results.some(r => r.status === 'fixed' && r.message.includes('Created assets/ directory'))).toBe(true)
    expect(results.some(r => r.status === 'fixed' && r.message.includes('assets/images/'))).toBe(true)
    expect(results.some(r => r.status === 'fixed' && r.message.includes('Created assets/.trash/'))).toBe(true)
  })

  it('warns about each missing type subdir without autoFix when assets/ exists', () => {
    mkdirSync(assetsRoot, { recursive: true })
    const results = checkAssets(testDir)
    // 7 asset type dirs missing, plus warning for missing/empty conditions
    expect(results.filter(r => r.status === 'warn' && r.message.includes('Missing assets/'))).toHaveLength(7)
  })

  it('reports ok when the tree is fully populated and clean', () => {
    seedFullAssetsTree()
    const results = checkAssets(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/0 asset\(s\), all sidecars present/)
  })
})

// ─── Missing sidecars ─────────────────────────────────────────────────────

describe('checkAssets — missing sidecars', () => {
  it('warns when an asset has no .meta.json (no autoFix)', () => {
    seedFullAssetsTree()
    const taskDir = join(imagesDir, 'task-abc')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, 'hero.png'), 'fake-image')

    const results = checkAssets(testDir)
    const sidecarWarn = results.find(r => r.status === 'warn' && r.message.includes('missing .meta.json sidecar'))
    expect(sidecarWarn).toBeDefined()
    expect(sidecarWarn!.autoFixable).toBe(true)
  })

  it('creates stub sidecars in autoFix mode', () => {
    mockAutoFix = true
    seedFullAssetsTree()
    const taskDir = join(imagesDir, 'task-abc')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, 'hero.png'), 'fake-image')

    const results = checkAssets(testDir)
    expect(existsSync(join(taskDir, 'hero.png.meta.json'))).toBe(true)
    const stub = JSON.parse(readFileSync(join(taskDir, 'hero.png.meta.json'), 'utf-8'))
    expect(stub.agent).toBe('unknown')
    expect(stub.taskId).toBe('task-abc')
    expect(results.some(r => r.status === 'fixed' && r.message.includes('Created 1 stub sidecar'))).toBe(true)
  })
})

// ─── Mismatched sidecars ──────────────────────────────────────────────────

describe('checkAssets — mismatched sidecars', () => {
  it('detects misnamed sidecar without autoFix', () => {
    seedFullAssetsTree()
    const taskDir = join(imagesDir, 'task-abc')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, '20260323-hero.png'), 'fake-image')
    // Misnamed: uses base "hero" rather than full filename
    writeFileSync(
      join(taskDir, 'hero.meta.json'),
      JSON.stringify({ author: 'pixel', taskId: 'task-abc', createdAt: '2026-03-23T14:00:00Z' }),
    )

    const results = checkAssets(testDir)
    const warns = results.filter(r => r.status === 'warn')
    expect(warns.some(r => r.message.includes('misnamed') || r.message.includes('missing'))).toBe(true)
  })

  it('merges misnamed sidecar into the correctly-named stub under autoFix, normalizing field names', () => {
    mockAutoFix = true
    seedFullAssetsTree()
    const taskDir = join(imagesDir, 'task-abc')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, '20260323-hero.png'), 'fake-image')

    // Pre-existing stub at the correct path (agent: "unknown")
    writeFileSync(
      join(taskDir, '20260323-hero.png.meta.json'),
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
      join(taskDir, 'hero.meta.json'),
      JSON.stringify({
        author: 'pixel',
        taskId: 'task-abc',
        createdAt: '2026-03-23T14:00:00Z',
        tool: 'dall-e-3',
        description: 'A hero',
      }),
    )

    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'fixed' && (r.message.includes('Merged') || r.message.includes('misnamed')))).toBe(true)

    const merged = JSON.parse(readFileSync(join(taskDir, '20260323-hero.png.meta.json'), 'utf-8'))
    expect(merged.agent).toBe('pixel')           // normalized from author
    expect(merged.created).toBe('2026-03-23T14:00:00Z')  // normalized from createdAt
    expect(merged.tool).toBe('dall-e-3')
    expect(existsSync(join(taskDir, 'hero.meta.json'))).toBe(false)  // mismatched removed
  })

  it('removes the misnamed sidecar when the correctly-named one already has real content', () => {
    mockAutoFix = true
    seedFullAssetsTree()
    const taskDir = join(imagesDir, 'task-abc')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, '20260323-hero.png'), 'fake-image')

    // Real (non-stub) sidecar at the correct path
    const realMeta = {
      agent: 'pixel',
      taskId: 'task-abc',
      created: '2026-03-23T15:00:00Z',
      description: 'Real',
    }
    writeFileSync(join(taskDir, '20260323-hero.png.meta.json'), JSON.stringify(realMeta, null, 2))

    // Misnamed orphan
    writeFileSync(join(taskDir, 'hero.meta.json'), JSON.stringify({ author: 'someone-else' }))

    checkAssets(testDir)

    // Real sidecar untouched, mismatched removed
    expect(JSON.parse(readFileSync(join(taskDir, '20260323-hero.png.meta.json'), 'utf-8'))).toEqual(realMeta)
    expect(existsSync(join(taskDir, 'hero.meta.json'))).toBe(false)
  })
})

// ─── Truly orphaned meta files ────────────────────────────────────────────

describe('checkAssets — orphaned meta', () => {
  it('warns about a .meta.json with no associated asset and no near-match', () => {
    seedFullAssetsTree()
    const taskDir = join(imagesDir, 'task-abc')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(
      join(taskDir, 'totally-unrelated.meta.json'),
      JSON.stringify({ agent: 'pixel', taskId: 'task-abc', created: '2026-03-23T00:00:00Z' }),
    )

    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('orphaned .meta.json'))).toBe(true)
  })
})

// ─── Trash purge ──────────────────────────────────────────────────────────

describe('checkAssets — trash purge', () => {
  it('purges trash items older than 7 days under autoFix', () => {
    mockAutoFix = true
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
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
    expect(results.some(r => r.status === 'fixed' && r.message.includes('Purged 1 expired'))).toBe(true)
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
    const taskDir = join(imagesDir, 'task-abc')
    mkdirSync(taskDir, { recursive: true })
    // Write a sparse 6 GB file via fs.truncateSync — fast on macOS APFS
    const bigFile = join(taskDir, 'huge.bin')
    writeFileSync(bigFile, '')
    require('fs').truncateSync(bigFile, 6 * 1024 * 1024 * 1024)
    // Sanity: file is reported as 6 GB
    expect(statSync(bigFile).size).toBe(6 * 1024 * 1024 * 1024)
    // Pair sidecar so it doesn't trip the missing-meta path
    writeFileSync(
      join(taskDir, 'huge.bin.meta.json'),
      JSON.stringify({ agent: 'pixel', taskId: 'task-abc', created: '2026-03-23T00:00:00Z' }),
    )

    const results = checkAssets(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('GB — consider cleanup'))).toBe(true)
  })
})
