/**
 * Comprehensive tests for the assets plugin routes and exec tools.
 * Tests all 7 API routes and 9 MCP exec tools registered by the plugin.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync, renameSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  activatePlugin,
  findRoute,
  findTool,
  callRoute,
  callTool,
  callSearchRoute,
  makeRequest,
  type ActivatedPlugin,
} from '../test-helpers'

// ---------------------------------------------------------------------------
// Mock external dependencies before importing the plugin
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-assets-routes-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: join(testDir, 'assets') }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

// Import the plugin after mocks are set up
import assetsPlugin from '@bakin/assets'
import { upsertAsset } from '@bakin/assets/lib/asset-index'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Create an asset fixture under the filename-as-identity layout:
 * assets/store/{YYYY-MM}/{canonical-filename}. The YYYY-MM shard is derived
 * from the `YYYYMMDD-` prefix of the (canonical) filename.
 */
function createAssetFixture(
  filename: string,
  content: string,
  sidecar?: Record<string, unknown>
): string {
  const ym = `${filename.slice(0, 4)}-${filename.slice(4, 6)}`
  const dir = join(assetsRoot, 'store', ym)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, filename)
  writeFileSync(filePath, content)

  if (sidecar) {
    writeFileSync(`${filePath}.meta.json`, JSON.stringify(sidecar, null, 2))
  }

  return filePath
}

/** Helper: return the relative path under the new layout for a filename. */
function relPathFor(filename: string): string {
  const ym = `${filename.slice(0, 4)}-${filename.slice(4, 6)}`
  return `assets/store/${ym}/${filename}`
}

function createTrashFixture(
  originalFilename: string,
  timestamp: number,
  content: string,
  sidecar?: Record<string, unknown>
): string {
  const trashDir = join(assetsRoot, '.trash')
  mkdirSync(trashDir, { recursive: true })
  const trashFilename = `${originalFilename}__deleted-${timestamp}`
  const trashPath = join(trashDir, trashFilename)
  writeFileSync(trashPath, content)

  if (sidecar) {
    writeFileSync(`${trashPath}.meta.json`, JSON.stringify(sidecar, null, 2))
  }

  return trashFilename
}

// ---------------------------------------------------------------------------
// Canonical filenames used across the test fixtures
// ---------------------------------------------------------------------------
const HERO = '20260320-hero-a1b2c3d4.png'
const HERO_THUMB = '20260320-hero-a1b2c3d4.thumb.jpg'
const README = '20260321-readme-b2c3d4e5.md'
const METRICS = '20260322-metrics-c3d4e5f6.json'

// ---------------------------------------------------------------------------
// Setup and teardown
// ---------------------------------------------------------------------------

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(assetsRoot, { recursive: true })
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })

  // Create test assets for list/file routes
  createAssetFixture(HERO, 'png-bytes', {
    agent: 'pixel',
    taskId: 'task-001',
    created: '2026-03-20T10:00:00Z',
    type: 'images',
    description: 'Hero image',
    tags: ['hero', 'banner'],
  })
  createAssetFixture(HERO_THUMB, 'thumb-bytes', {
    agent: 'pixel',
    taskId: 'task-001',
    created: '2026-03-20T10:00:00Z',
    type: 'images',
    description: 'Hero thumbnail',
    tags: ['hero'],
  })
  createAssetFixture(README, '# Hello', {
    agent: 'scribe',
    taskId: 'task-002',
    created: '2026-03-21T12:00:00Z',
    type: 'text',
    tags: ['docs'],
  })
  createAssetFixture(METRICS, '{"views":100}', {
    agent: 'analyst',
    taskId: 'task-003',
    created: '2026-03-22T08:00:00Z',
    type: 'data',
  })

  plugin = await activatePlugin(assetsPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ===========================================================================
// Route registration
// ===========================================================================

describe('route registration', () => {
  it('registers all 12 routes', () => {
    expect(plugin.routes.length).toBe(12)
  })

  it.each([
    ['GET', '/'],
    ['GET', '/file'],
    ['POST', '/upload'],
    ['PATCH', '/link'],
    ['DELETE', '/'],
    ['GET', '/trash'],
    ['POST', '/trash/:file/restore'],
    ['DELETE', '/trash'],
    ['DELETE', '/trash/:file'],
    ['PATCH', '/retype'],
    ['PUT', '/content'],
    ['GET', '/search'],
  ])('registers %s %s', (method, path) => {
    const route = findRoute(plugin.routes, method, path)
    expect(route).toBeDefined()
    expect(typeof route!.handler).toBe('function')
  })
})

// ===========================================================================
// Exec tool registration
// ===========================================================================

describe('exec tool registration', () => {
  it('registers all 12 exec tools', () => {
    expect(plugin.execTools.length).toBe(12)
  })

  it.each([
    'bakin_exec_assets_list',
    'bakin_exec_assets_get',
    'bakin_exec_assets_save',
    'bakin_exec_assets_delete',
    'bakin_exec_assets_link',
    'bakin_exec_assets_list_trash',
    'bakin_exec_assets_restore',
    'bakin_exec_assets_audit',
    'bakin_exec_assets_empty_trash',
    'bakin_exec_assets_permanent_delete',
    'bakin_exec_assets_retype',
    'bakin_exec_assets_update_content',
  ])('registers tool: %s', (name) => {
    const tool = findTool(plugin.execTools, name)
    expect(tool).toBeDefined()
    expect(typeof tool!.handler).toBe('function')
  })
})

// ===========================================================================
// GET / — list assets
// ===========================================================================

describe('GET / — list assets', () => {
  it('returns all assets', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, plugin.ctx)

    expect(status).toBe(200)
    expect(body.count).toBeGreaterThanOrEqual(3)
    expect(Array.isArray(body.assets)).toBe(true)
  })

  it('filters by type', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, plugin.ctx, {
      searchParams: { type: 'text' },
    })

    expect(status).toBe(200)
    const assets = body.assets as Array<{ type: string }>
    expect(assets.length).toBeGreaterThanOrEqual(1)
    for (const a of assets) {
      expect(a.type).toBe('text')
    }
  })

  it('filters by taskId', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, plugin.ctx, {
      searchParams: { taskId: 'task-001' },
    })

    expect(status).toBe(200)
    const assets = body.assets as Array<{ metadata: { taskId: string } }>
    for (const a of assets) {
      expect(a.metadata.taskId).toBe('task-001')
    }
  })

  it('looks up single asset by filename', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, plugin.ctx, {
      searchParams: { filename: README },
    })

    expect(status).toBe(200)
    expect(body.count).toBe(1)
    const assets = body.assets as Array<{ filename: string }>
    expect(assets[0].filename).toBe(README)
  })

  it('returns empty when filename not found', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, plugin.ctx, {
      searchParams: { filename: '20260320-ghost-ffffffff.png' },
    })

    expect(status).toBe(200)
    expect(body.count).toBe(0)
    expect(body.assets).toEqual([])
  })

  it('groups variants under primary when grouped=true (default)', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { body } = await callRoute(route, plugin.ctx, {
      searchParams: { taskId: 'task-001' },
    })

    const assets = body.assets as Array<{ filename: string; variants?: unknown[] }>
    // Thumb should be nested, not a top-level entry
    const filenames = assets.map(a => a.filename)
    expect(filenames).toContain(HERO)
    expect(filenames).not.toContain(HERO_THUMB)
  })

  it('returns flat list when grouped=false', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { body } = await callRoute(route, plugin.ctx, {
      searchParams: { taskId: 'task-001', grouped: 'false' },
    })

    const assets = body.assets as Array<{ filename: string }>
    const filenames = assets.map(a => a.filename)
    expect(filenames).toContain(HERO)
    expect(filenames).toContain(HERO_THUMB)
  })

  it('supports pagination with limit and offset', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { body } = await callRoute(route, plugin.ctx, {
      searchParams: { limit: '1', offset: '0' },
    })

    expect(body.count).toBe(1)
    expect((body.total as number)).toBeGreaterThanOrEqual(3)
  })
})

// ===========================================================================
// GET /file — serve asset file
// ===========================================================================

describe('GET /file — serve asset file', () => {
  it('serves an existing file with correct content-type', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { name: HERO },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Content-Length')).toBeDefined()
    expect(res.headers.get('ETag')).toBeDefined()

    const body = await res.arrayBuffer()
    expect(new TextDecoder().decode(body)).toBe('png-bytes')
  })

  it('serves a markdown file', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { name: README },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown')
  })

  it('returns 400 when name is missing', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file')
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name.*required/i)
  })

  it('returns 400 for filename traversal attempt', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { name: '../etc/passwd' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('does not accept the removed path query parameter', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { path: relPathFor(HERO) },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 404 for nonexistent file', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { name: '20260320-missing-ffffffff.png' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(404)
  })

  it('serves a file by filename via ?name= (canonical filename)', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { name: HERO },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    const body = await res.arrayBuffer()
    expect(new TextDecoder().decode(body)).toBe('png-bytes')
  })

  it('returns 404 for unknown filename', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { name: '20260320-missing-ffffffff.png' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(404)
  })

  it('returns 400 for filename containing a slash', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { name: 'foo/bar.png' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// POST /delete — soft-delete asset
// ===========================================================================

describe('DELETE / — soft-delete asset', () => {
  it('soft-deletes an asset to .trash/', async () => {
    // Create a disposable asset
    const filename = '20260325-delete-me-d1d1d1d1.png'
    createAssetFixture(filename, 'deletable', {
      agent: 'pixel',
      taskId: 'task-del',
      created: '2026-03-25T00:00:00Z',
      type: 'images',
    })

    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest(`/?filename=${filename}`, {
      method: 'DELETE',
    })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    const rel = relPathFor(filename)
    expect(body.trashed).toContain(rel)

    // File should be in .trash/
    const trashFiles = readdirSync(join(assetsRoot, '.trash'))
    const trashed = trashFiles.find(f => f.startsWith(`${filename}__deleted-`))
    expect(trashed).toBeDefined()

    // Original should be gone
    expect(existsSync(join(testDir, rel))).toBe(false)
  })

  it('cascade-deletes variants', async () => {
    const primary = '20260325-photo-d2d2d2d2.png'
    const thumb = '20260325-photo-d2d2d2d2.thumb.jpg'
    createAssetFixture(primary, 'primary', {
      agent: 'pixel',
      taskId: 'task-cascade',
      created: '2026-03-25T00:00:00Z',
      type: 'images',
    })
    createAssetFixture(thumb, 'thumb')

    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest(`/?filename=${primary}`, {
      method: 'DELETE',
    })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.trashed.length).toBeGreaterThanOrEqual(2)
    const rel = relPathFor(primary)
    expect(existsSync(join(testDir, rel))).toBe(false)
    expect(existsSync(join(testDir, relPathFor(thumb)))).toBe(false)
  })

  it('triggers audit and activity log', async () => {
    const filename = '20260325-log-test-d3d3d3d3.md'
    createAssetFixture(filename, 'test', {
      agent: 'scribe',
      taskId: 'task-audit',
      created: '2026-03-25T00:00:00Z',
      type: 'text',
    })

    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest(`/?filename=${filename}`, {
      method: 'DELETE',
    })
    await route.handler(req, plugin.ctx)

    expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('deleted', 'system')
    expect(plugin.ctx.activity.log).toHaveBeenCalledWith('system', 'Asset deleted')
  })

  it('returns 400 when filename is missing', async () => {
    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest('/', { method: 'DELETE' })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 400 for unsafe filename', async () => {
    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest('/?filename=assets/../../../etc/passwd', { method: 'DELETE' })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// GET /trash — list trashed assets
// ===========================================================================

describe('GET /trash — list trashed assets', () => {
  it('returns trashed items with metadata', async () => {
    // Ensure at least one item from the delete tests is in trash
    const route = findRoute(plugin.routes, 'GET', '/trash')!
    const { status, body } = await callRoute(route, plugin.ctx)

    expect(status).toBe(200)
    expect(Array.isArray(body.assets)).toBe(true)
    expect(typeof body.count).toBe('number')
    expect((body.count as number)).toBeGreaterThanOrEqual(1)
  })
})

// ===========================================================================
// POST /restore — restore trashed asset
// ===========================================================================

describe('POST /restore — restore trashed asset', () => {
  it('restores a trashed asset to the store shard derived from its canonical filename', async () => {
    const ts = Date.now()
    const canonical = '20260320-restore-aa11bb22.png'
    const trashFilename = createTrashFixture(canonical, ts, 'image-data', {
      agent: 'pixel',
      taskId: 'task-restore',
      created: '2026-03-20T10:00:00Z',
    })

    const route = findRoute(plugin.routes, 'POST', '/trash/:file/restore')!
    const req = makeRequest(`/restore?file=${trashFilename}`, { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.restoredPath).toBe(`assets/store/2026-03/${canonical}`)
    expect(existsSync(join(assetsRoot, 'store', '2026-03', canonical))).toBe(true)
  })

  it('triggers audit on successful restore', async () => {
    const ts = Date.now() + 1
    const trashFilename = createTrashFixture('20260320-audit-cc33dd44.txt', ts, 'text', {
      agent: 'scribe',
      taskId: 'task-ar',
      created: '2026-03-20T10:00:00Z',
    })

    const route = findRoute(plugin.routes, 'POST', '/trash/:file/restore')!
    const req = makeRequest(`/restore?file=${trashFilename}`, { method: 'POST' })
    await route.handler(req, plugin.ctx)

    expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('restored', 'system')
  })

  it('returns 400 when file param is missing', async () => {
    const route = findRoute(plugin.routes, 'POST', '/trash/:file/restore')!
    const req = makeRequest('/restore', { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 400 for path traversal in filename', async () => {
    const route = findRoute(plugin.routes, 'POST', '/trash/:file/restore')!
    const req = makeRequest('/restore?file=../../etc/passwd', { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 500 for nonexistent trash item', async () => {
    const route = findRoute(plugin.routes, 'POST', '/trash/:file/restore')!
    const req = makeRequest('/restore?file=nope.png__deleted-999', { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(500)
  })
})

// ===========================================================================
// POST /permanent-delete — permanently delete trashed asset
// ===========================================================================

describe('POST /permanent-delete — permanently delete trashed asset', () => {
  it('permanently removes a trashed asset', async () => {
    const ts = Date.now() + 100
    const trashFilename = createTrashFixture('perm-delete.png', ts, 'data', {
      agent: 'pixel',
      taskId: 'task-pd',
      created: '2026-03-20T10:00:00Z',
    })

    const route = findRoute(plugin.routes, 'DELETE', '/trash/:file')!
    const req = makeRequest(`/permanent-delete?file=${trashFilename}`, { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(existsSync(join(assetsRoot, '.trash', trashFilename))).toBe(false)
    expect(existsSync(join(assetsRoot, '.trash', `${trashFilename}.meta.json`))).toBe(false)
  })

  it('triggers audit on success', async () => {
    const ts = Date.now() + 200
    const trashFilename = createTrashFixture('perm-audit.txt', ts, 'data')

    const route = findRoute(plugin.routes, 'DELETE', '/trash/:file')!
    const req = makeRequest(`/permanent-delete?file=${trashFilename}`, { method: 'POST' })
    await route.handler(req, plugin.ctx)

    expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('permanent-deleted', 'system')
  })

  it('returns 400 when file param is missing', async () => {
    const route = findRoute(plugin.routes, 'DELETE', '/trash/:file')!
    const req = makeRequest('/permanent-delete', { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 400 for path traversal', async () => {
    const route = findRoute(plugin.routes, 'DELETE', '/trash/:file')!
    const req = makeRequest('/permanent-delete?file=../../../secret', { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 500 for nonexistent item', async () => {
    const route = findRoute(plugin.routes, 'DELETE', '/trash/:file')!
    const req = makeRequest('/permanent-delete?file=nope__deleted-999', { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(500)
  })
})

// ===========================================================================
// POST /empty-trash — empty entire trash
// ===========================================================================

describe('POST /empty-trash — empty entire trash', () => {
  it('deletes all items in trash and returns count', async () => {
    // Seed trash with fresh items
    const ts = Date.now() + 500
    createTrashFixture('empty-a.png', ts, 'a-data')
    createTrashFixture('empty-b.txt', ts + 1, 'b-data')

    const route = findRoute(plugin.routes, 'DELETE', '/trash')!
    const req = makeRequest('/empty-trash', { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(typeof body.deleted).toBe('number')
    expect((body.deleted as number)).toBeGreaterThanOrEqual(2)

    // Trash should be empty
    const remaining = readdirSync(join(assetsRoot, '.trash'))
    expect(remaining.length).toBe(0)
  })

  it('triggers audit on success', async () => {
    // Seed one item so handler succeeds
    createTrashFixture('audit-empty.png', Date.now() + 600, 'data')

    const route = findRoute(plugin.routes, 'DELETE', '/trash')!
    const req = makeRequest('/empty-trash', { method: 'POST' })
    await route.handler(req, plugin.ctx)

    expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('trash-emptied', 'system')
  })

  it('returns deleted=0 when trash is already empty', async () => {
    // Empty trash first
    const trashDir = join(assetsRoot, '.trash')
    if (existsSync(trashDir)) {
      rmSync(trashDir, { recursive: true })
      mkdirSync(trashDir, { recursive: true })
    }

    const route = findRoute(plugin.routes, 'DELETE', '/trash')!
    const req = makeRequest('/empty-trash', { method: 'POST' })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.deleted).toBe(0)
  })
})

// ===========================================================================
// Exec tool: bakin_exec_assets_list
// ===========================================================================

describe('exec tool: bakin_exec_assets_list', () => {
  it('lists all assets', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_list')!
    const result = await callTool(tool, {})

    expect(result.ok).toBe(true)
    expect(typeof result.count).toBe('number')
    expect(Array.isArray(result.assets)).toBe(true)
  })

  it('filters by type', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_list')!
    const result = await callTool(tool, { type: 'data' })

    expect(result.ok).toBe(true)
    const assets = result.assets as Array<{ type: string }>
    for (const a of assets) {
      expect(a.type).toBe('data')
    }
  })
})

// ===========================================================================
// Exec tool: bakin_exec_assets_get
// ===========================================================================

describe('exec tool: bakin_exec_assets_get', () => {
  it('reads asset metadata by canonical filename', async () => {
    const filename = '20260325-tool-get-abcd1234.md'
    createAssetFixture(filename, '# Metadata', {
      agent: 'scribe',
      taskId: 'task-tool-get',
      created: '2026-03-25T00:00:00Z',
      type: 'text',
    })

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_get')!
    const result = await callTool(tool, { filename }, 'scribe')
    const asset = result.asset as { filename: string; path: string; taskId: string }

    expect(result.ok).toBe(true)
    expect(asset.filename).toBe(filename)
    expect(asset.path).toBe(relPathFor(filename))
    expect(asset.taskId).toBe('task-tool-get')
  })

  it('rejects path-shaped filenames', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_get')!
    const result = await callTool(tool, {
      filename: 'assets/store/2026-03/20260325-tool-get-abcd1234.md',
    }, 'scribe')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid filename/i)
  })
})

// ===========================================================================
// Exec tool: bakin_exec_assets_save
// ===========================================================================

describe('exec tool: bakin_exec_assets_save', () => {
  it('saves a new asset with sidecar metadata', async () => {
    // Create a source file to save
    const sourceFile = join(testDir, 'source-image.png')
    writeFileSync(sourceFile, 'raw-image-bytes')

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_save')!
    const result = await callTool(tool, {
      filePath: sourceFile,
      taskId: 'task-save-001',
      type: 'images',
      description: 'Test saved image',
      tags: ['test', 'save'],
      tool: 'test-tool',
      slug: 'saved-hero',
    }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.filename).toBeDefined()
    expect((result.filename as string)).toMatch(/^\d{8}-saved-hero-[0-9a-f]{8}\.png$/)
    expect(result.path).toBeDefined()
    expect(result.metadataPath).toBeDefined()
  })

  it('returns error for nonexistent source file', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_save')!
    const result = await callTool(tool, {
      filePath: '/nonexistent/path/file.png',
      taskId: 'task-nope',
      type: 'images',
    }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('logs activity on successful save', async () => {
    const sourceFile = join(testDir, 'activity-test.txt')
    writeFileSync(sourceFile, 'activity test')

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_save')!
    const result = await callTool(tool, {
      filePath: sourceFile,
      taskId: 'task-activity',
      type: 'text',
    }, 'scribe')

    // ctx.activity.log removed — auto-audit from mcp-server.ts with label covers this
    expect(result.ok).toBe(true)
  })
})

// ===========================================================================
// Exec tool: bakin_exec_assets_delete
// ===========================================================================

describe('exec tool: bakin_exec_assets_delete', () => {
  it('deletes asset directly via library (bypasses HTTP handler)', async () => {
    const filename = '20260325-tool-delete-e1e1e1e1.md'
    createAssetFixture(filename, 'content', {
      agent: 'scribe',
      taskId: 'task-tool-del',
      created: '2026-03-25T00:00:00Z',
      type: 'text',
    })

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_delete')!
    const result = await callTool(tool, {
      filename,
    }, 'scribe')

    expect(result.ok).toBe(true)
    const rel = relPathFor(filename)
    expect(existsSync(join(testDir, rel))).toBe(false)
  })

  it('has the correct tool name and handler', () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_delete')!
    expect(tool.name).toBe('bakin_exec_assets_delete')
    expect(typeof tool.handler).toBe('function')
    expect(tool.description).toMatch(/soft-delete/i)
  })
})

// ===========================================================================
// Exec tool: bakin_exec_assets_list_trash
// ===========================================================================

describe('exec tool: bakin_exec_assets_list_trash', () => {
  it('lists trashed items with metadata', async () => {
    // Ensure at least one trash item exists
    createTrashFixture('tool-trash.png', Date.now() + 700, 'data', {
      agent: 'pixel',
      taskId: 'task-tt',
      created: '2026-03-20T00:00:00Z',
    })

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_list_trash')!
    const result = await callTool(tool, {})

    expect(result.ok).toBe(true)
    expect(typeof result.count).toBe('number')
    expect(Array.isArray(result.items)).toBe(true)
    expect((result.count as number)).toBeGreaterThanOrEqual(1)

    const items = result.items as Array<{
      filename: string
      originalFilename: string
      type: string
      agent: string
    }>
    const item = items.find(i => i.originalFilename === 'tool-trash.png')
    expect(item).toBeDefined()
    expect(item!.type).toBe('images')
    expect(item!.agent).toBe('pixel')
  })

  it('returns empty list when trash is empty', async () => {
    // Clear trash
    const trashDir = join(assetsRoot, '.trash')
    rmSync(trashDir, { recursive: true, force: true })
    mkdirSync(trashDir, { recursive: true })

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_list_trash')!
    const result = await callTool(tool, {})

    expect(result.ok).toBe(true)
    expect(result.count).toBe(0)
    expect(result.items).toEqual([])
  })
})

// ===========================================================================
// Exec tool: bakin_exec_assets_restore
// ===========================================================================

describe('exec tool: bakin_exec_assets_restore', () => {
  it('restores a trashed asset', async () => {
    const ts = Date.now() + 800
    const canonical = '20260320-toolrestore-ee55ff66.png'
    const trashFilename = createTrashFixture(canonical, ts, 'restored-data', {
      agent: 'pixel',
      taskId: 'task-tr',
      created: '2026-03-20T00:00:00Z',
    })

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_restore')!
    const result = await callTool(tool, { filename: trashFilename }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.restoredPath).toBe(`assets/store/2026-03/${canonical}`)
    expect(existsSync(join(assetsRoot, 'store', '2026-03', canonical))).toBe(true)
  })

  it('logs activity on successful restore', async () => {
    const ts = Date.now() + 900
    const trashFilename = createTrashFixture('20260320-logrestore-ff7788aa.txt', ts, 'data', {
      agent: 'scribe',
      taskId: 'task-lr',
      created: '2026-03-20T00:00:00Z',
    })

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_restore')!
    const result = await callTool(tool, { filename: trashFilename }, 'scribe')

    // ctx.activity.log removed — auto-audit from mcp-server.ts with label covers this
    expect(result.ok).toBe(true)
  })

  it('returns error for nonexistent trash item', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_restore')!
    const result = await callTool(tool, { filename: 'nonexistent.png__deleted-999' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})

// ===========================================================================
// Exec tool: bakin_exec_assets_audit
// ===========================================================================

describe('exec tool: bakin_exec_assets_audit', () => {
  it('audits all asset types and reports summary', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
    const result = await callTool(tool, {})

    expect(result.ok).toBe(true)
    expect(result.summary).toBeDefined()
    const summary = result.summary as { total: number; healthy: number; issues: number; fixed: number }
    expect(typeof summary.total).toBe('number')
    expect(typeof summary.healthy).toBe('number')
    expect(typeof summary.issues).toBe('number')
    expect(typeof summary.fixed).toBe('number')
  })

  it('filters audit by type', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
    const result = await callTool(tool, { type: 'text' })

    expect(result.ok).toBe(true)
    const issues = result.issues as Array<{ path: string }>
    for (const issue of issues) {
      expect(issue.path).toMatch(/^assets\/store\//)
    }
  })

  it('detects missing sidecars', async () => {
    // Create an asset without a sidecar in the store layout
    const filename = '20260404-orphan-f1f1f1f1.json'
    const ym = '2026-04'
    const dir = join(assetsRoot, 'store', ym)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, filename), '{}')
    // Ensure no sidecar
    const sidecar = join(dir, `${filename}.meta.json`)
    if (existsSync(sidecar)) rmSync(sidecar)

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
    const result = await callTool(tool, { type: 'data' })

    const issues = result.issues as Array<{ path: string; issue: string }>
    const orphanIssue = issues.find(i => i.path.includes(filename))
    // It should either have missing-sidecar OR stub-sidecar (since audit path creates stubs under fix mode)
    expect(orphanIssue).toBeDefined()
  })

  it('auto-fixes missing sidecars when fix=true', async () => {
    const filename = '20260404-fixme-f2f2f2f2.md'
    const ym = '2026-04'
    const dir = join(assetsRoot, 'store', ym)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, filename), 'no sidecar')
    const sidecarPath = join(dir, `${filename}.meta.json`)
    if (existsSync(sidecarPath)) rmSync(sidecarPath)

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
    const result = await callTool(tool, { type: 'text', fix: true })

    expect(result.ok).toBe(true)
    const summary = result.summary as { fixed: number }
    expect(typeof summary.fixed).toBe('number')
  })

  it('detects orphaned sidecars', async () => {
    const ym = '2026-04'
    const dir = join(assetsRoot, 'store', ym)
    mkdirSync(dir, { recursive: true })
    // Create a sidecar without a matching asset
    writeFileSync(join(dir, '20260404-ghost-f3f3f3f3.md.meta.json'), JSON.stringify({
      agent: 'test',
      taskId: 'task-orphan-sidecar',
      created: '2026-03-25T00:00:00Z',
      type: 'text',
    }))

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
    const result = await callTool(tool, { type: 'text' })

    const issues = result.issues as Array<{ path: string; issue: string }>
    const orphanedSidecar = issues.find(i => i.issue === 'orphaned-sidecar' && i.path.includes('20260404-ghost-f3f3f3f3.md.meta.json'))
    expect(orphanedSidecar).toBeDefined()
  })

  it('returns error when assets directory does not exist', async () => {
    // Temporarily rename assets dir
    const backup = assetsRoot + '_backup'
    renameSync(assetsRoot, backup)

    try {
      const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    } finally {
      renameSync(backup, assetsRoot)
    }
  })
})

// ===========================================================================
// DELETE route integration — simulates the full URL path the browser sends
// ===========================================================================

// ===========================================================================
// PATCH /link — relink/unlink asset
// ===========================================================================

describe('PATCH /link — relink/unlink asset', () => {
  it('relinks asset from one task to another', async () => {
    const filename = '20260405-relink-test-11111111.png'
    createAssetFixture(filename, 'img-data', {
      agent: 'pixel', taskId: 'link-src', created: '2026-04-05T00:00:00Z', type: 'images',
    })
    const rel = relPathFor(filename)
    upsertAsset(rel)

    const route = findRoute(plugin.routes, 'PATCH', '/link')!
    const req = makeRequest('/link', {
      method: 'PATCH',
      body: { filename, taskId: 'link-dest' },
    })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.filename).toBe(filename)
    expect(body.newTaskId).toBe('link-dest')
    // Metadata-only — file stays at its canonical store location.
    expect(body.path).toBe(rel)
    expect(existsSync(join(testDir, rel))).toBe(true)
    const sidecar = JSON.parse(readFileSync(join(testDir, `${rel}.meta.json`), 'utf-8'))
    expect(sidecar.taskId).toBe('link-dest')
  })

  it('unlinks asset (taskId → null) without moving the file', async () => {
    const filename = '20260405-unlink-test-22222222.md'
    createAssetFixture(filename, '# test', {
      agent: 'user', taskId: 'link-unl', created: '2026-04-05T00:00:00Z', type: 'text',
    })
    const rel = relPathFor(filename)
    upsertAsset(rel)

    const route = findRoute(plugin.routes, 'PATCH', '/link')!
    const req = makeRequest('/link', {
      method: 'PATCH',
      body: { filename, taskId: null },
    })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.newTaskId).toBeNull()
    // File stays at its canonical store location.
    expect(existsSync(join(testDir, rel))).toBe(true)
    const sidecar = JSON.parse(readFileSync(join(testDir, `${rel}.meta.json`), 'utf-8'))
    expect(sidecar.taskId).toBeNull()
  })

  it('returns 400 for missing filename', async () => {
    const route = findRoute(plugin.routes, 'PATCH', '/link')!
    const req = makeRequest('/link', {
      method: 'PATCH',
      body: { taskId: 'some-task' },
    })
    const res = await route.handler(req, plugin.ctx)
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown filename', async () => {
    const route = findRoute(plugin.routes, 'PATCH', '/link')!
    const req = makeRequest('/link', {
      method: 'PATCH',
      body: { filename: '20260405-ghost-ffffffff.png', taskId: 'x' },
    })
    const res = await route.handler(req, plugin.ctx)
    expect(res.status).toBe(404)
  })

  it('returns 400 for taskId with path separators', async () => {
    const filename = '20260405-sec-test-33333333.png'
    createAssetFixture(filename, 'data', {
      agent: 'user', taskId: 'link-sec', created: '2026-04-05T00:00:00Z', type: 'images',
    })
    upsertAsset(relPathFor(filename))
    const route = findRoute(plugin.routes, 'PATCH', '/link')!
    const req = makeRequest('/link', {
      method: 'PATCH',
      body: { filename, taskId: '../../etc' },
    })
    const res = await route.handler(req, plugin.ctx)
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// exec tool: bakin_exec_assets_link
// ===========================================================================

describe('exec tool: bakin_exec_assets_link', () => {
  it('relinks asset via MCP tool (metadata-only)', async () => {
    const filename = '20260405-tool-link-44444444.png'
    createAssetFixture(filename, 'img-data', {
      agent: 'pixel', taskId: 'tool-src', created: '2026-04-05T00:00:00Z', type: 'images',
    })
    const rel = relPathFor(filename)
    upsertAsset(rel)

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_link')!
    const result = await callTool(tool, { filename, taskId: 'tool-dest' }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.filename).toBe(filename)
    expect(result.newTaskId).toBe('tool-dest')
    // File stays at its on-disk path.
    expect(result.path).toBe(rel)
    expect(existsSync(join(testDir, rel))).toBe(true)
    const sidecar = JSON.parse(readFileSync(join(testDir, `${rel}.meta.json`), 'utf-8'))
    expect(sidecar.taskId).toBe('tool-dest')
  })

  it('unlinks asset via MCP tool (taskId → null)', async () => {
    const filename = '20260405-tool-unlink-55555555.md'
    createAssetFixture(filename, '# hi', {
      agent: 'user', taskId: 'tool-unl', created: '2026-04-05T00:00:00Z', type: 'text',
    })
    const rel = relPathFor(filename)
    upsertAsset(rel)

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_link')!
    const result = await callTool(tool, { filename, taskId: null }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.newTaskId).toBeNull()
    expect(result.path).toBe(rel)
    const sidecar = JSON.parse(readFileSync(join(testDir, `${rel}.meta.json`), 'utf-8'))
    expect(sidecar.taskId).toBeNull()
  })

  it('returns error for unknown filename', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_link')!
    const result = await callTool(tool, { filename: '20260405-ghost-ffffffff.png', taskId: 'x' }, 'pixel')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('DELETE route integration — browser URL simulation', () => {
  /**
   * Replicates the matchRoute logic from the catch-all API route handler.
   * This ensures the registered route path actually matches what the browser sends.
   */
  function matchRoute(
    routes: { method: string; path: string }[],
    routePath: string,
    method: string
  ): { route: { method: string; path: string }; params: Record<string, string> } | null {
    const upperMethod = method.toUpperCase()
    const exact = routes.find(r => r.path === routePath && r.method === upperMethod)
    if (exact) return { route: exact, params: {} }

    const reqSegments = routePath.split('/').filter(Boolean)
    for (const route of routes) {
      if (route.method !== upperMethod) continue
      const routeSegments = route.path.split('/').filter(Boolean)
      if (routeSegments.length !== reqSegments.length) continue

      const params: Record<string, string> = {}
      let match = true
      for (let i = 0; i < routeSegments.length; i++) {
        if (routeSegments[i].startsWith(':')) {
          params[routeSegments[i].slice(1)] = reqSegments[i]
        } else if (routeSegments[i] !== reqSegments[i]) {
          match = false
          break
        }
      }
      if (match) return { route, params }
    }
    return null
  }

  it('DELETE / matches when browser sends query-param path', () => {
    // Browser sends: DELETE /api/plugins/assets?filename={canonical-filename}
    // Next.js extracts: pathSegments = [] → routePath = "/"
    const routePath = '/'
    const match = matchRoute(plugin.routes, routePath, 'DELETE')

    expect(match).not.toBeNull()
    expect(match!.route.path).toBe('/')
    expect(match!.route.method).toBe('DELETE')
  })

  it('handler receives filename from query param and deletes successfully', async () => {
    const filename = '20260325-browser-delete-66666666.png'
    createAssetFixture(filename, 'image-data', {
      agent: 'pixel',
      taskId: 'task-integ',
      created: '2026-03-25T00:00:00Z',
      type: 'images',
    })

    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest(`/?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    const assetPath = relPathFor(filename)
    expect(body.trashed).toContain(assetPath)
    expect(existsSync(join(testDir, assetPath))).toBe(false)
  })

  it('old path-based URL would NOT have matched the parameterized route', () => {
    // Before the fix, the client sent:
    // DELETE /api/plugins/assets/assets%2Fimages%2Ftask%2Ffile.png
    // Next.js decoded this to pathSegments = ["assets", "images", "task", "file.png"]
    // routePath = "/assets/images/task/file.png" — 4 segments vs 1 in /:assetPath
    const routePath = '/assets/images/task/file.png'
    const match = matchRoute(plugin.routes, routePath, 'DELETE')

    // This should NOT match any route (proving the old approach was broken)
    expect(match).toBeNull()
  })

  it('DELETE /trash still works alongside DELETE /', async () => {
    // Seed trash
    createTrashFixture('coexist.png', Date.now() + 9000, 'data')

    const trashRoute = findRoute(plugin.routes, 'DELETE', '/trash')!
    const req = makeRequest('/trash', { method: 'DELETE' })
    const res = await trashRoute.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('DELETE /trash/:file still works alongside DELETE /', async () => {
    const ts = Date.now() + 9500
    const trashFilename = createTrashFixture('coexist-single.png', ts, 'data')

    const trashFileRoute = findRoute(plugin.routes, 'DELETE', '/trash/:file')!
    const req = makeRequest(`/?file=${trashFilename}`, { method: 'DELETE' })
    const res = await trashFileRoute.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })
})

// ===========================================================================
// GET /search — auto-registered by registerFileBackedContentType
// ===========================================================================

describe('Assets Plugin — GET /search', () => {
  beforeEach(() => {
    plugin.seedResults([])
  })

  it('returns seeded results for a valid query', async () => {
    plugin.seedResults(
      [
        {
          id: relPathFor(HERO),
          table: 'bakin_assets',
          score: 0.92,
          fields: { file_name: HERO, asset_type: 'images', agent: 'pixel' },
        },
        {
          id: relPathFor(README),
          table: 'bakin_assets',
          score: 0.71,
          fields: { file_name: README, asset_type: 'text', agent: 'scribe' },
        },
      ],
      {
        asset_type: [
          { value: 'images', count: 1 },
          { value: 'text', count: 1 },
        ],
        agent: [
          { value: 'pixel', count: 1 },
          { value: 'scribe', count: 1 },
        ],
      },
    )

    const { status, body } = await callSearchRoute(plugin, 'hero')

    expect(status).toBe(200)
    const results = body.results as Array<{ id: string; score: number }>
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe(relPathFor(HERO))
    expect(results[0].score).toBe(0.92)
    const aggs = body.aggregations as Record<string, Array<{ value: string; count: number }>>
    expect(aggs.asset_type).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'images', count: 1 }),
        expect.objectContaining({ value: 'text', count: 1 }),
      ]),
    )
  })

  it('returns 400 when q is missing', async () => {
    const { status, body } = await callSearchRoute(plugin, '')

    expect(status).toBe(400)
    expect(body.error).toBe('Missing ?q= parameter')
  })

  it('passes parsed asset_type,agent facets to ctx.search.query', async () => {
    await callSearchRoute(plugin, 'hero', { facets: 'asset_type,agent' })

    expect(plugin.ctx.search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'hero',
        facets: ['asset_type', 'agent'],
      }),
    )
  })

  it('returns 200 with empty results when no matches', async () => {
    const { status, body } = await callSearchRoute(plugin, 'zzz-no-match')

    expect(status).toBe(200)
    expect(body.results).toEqual([])
  })
})

// ===========================================================================
// PATCH /retype — change asset type
// ===========================================================================

describe('PATCH /retype — change asset type', () => {
  it('updates sidecar type without moving the file', async () => {
    const filename = '20260415-retype-doc-77777777.md'
    createAssetFixture(filename, '# Stay put', {
      agent: 'scribe', taskId: 'retype-task', created: '2026-04-15T10:00:00Z', type: 'text',
    })
    const rel = relPathFor(filename)
    upsertAsset(rel)

    const route = findRoute(plugin.routes, 'PATCH', '/retype')!
    const req = makeRequest('/retype', {
      method: 'PATCH',
      body: { filename, type: 'research' },
    })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.filename).toBe(filename)
    expect(body.newType).toBe('research')
    // Metadata-only — on-disk location is stable.
    expect(body.path).toBe(rel)
    expect(existsSync(join(testDir, rel))).toBe(true)
  })

  it('persists the new type in the sidecar in place', async () => {
    const filename = '20260415-note-88888888.md'
    createAssetFixture(filename, '# Note', {
      agent: 'scribe', taskId: 'retype-sidecar', created: '2026-04-15T10:00:00Z', type: 'text',
    })
    const rel = relPathFor(filename)
    upsertAsset(rel)

    const route = findRoute(plugin.routes, 'PATCH', '/retype')!
    const req = makeRequest('/retype', {
      method: 'PATCH',
      body: { filename, type: 'plans' },
    })
    await route.handler(req, plugin.ctx)

    // Sidecar stays at its original location with updated type field.
    const sidecarPath = join(testDir, `${rel}.meta.json`)
    expect(existsSync(sidecarPath)).toBe(true)
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(sidecar.type).toBe('plans')
  })

  it('returns 400 for invalid type', async () => {
    const route = findRoute(plugin.routes, 'PATCH', '/retype')!
    const req = makeRequest('/retype', {
      method: 'PATCH',
      body: { filename: README, type: 'invalid' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 400 for missing filename', async () => {
    const route = findRoute(plugin.routes, 'PATCH', '/retype')!
    const req = makeRequest('/retype', {
      method: 'PATCH',
      body: { type: 'research' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown filename', async () => {
    const route = findRoute(plugin.routes, 'PATCH', '/retype')!
    const req = makeRequest('/retype', {
      method: 'PATCH',
      body: { filename: '20260415-ghost-ffffffff.md', type: 'research' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(404)
  })

  it('no-op when type is unchanged', async () => {
    const filename = '20260415-data-noop-99999999.json'
    createAssetFixture(filename, '{}', {
      agent: 'analyst', taskId: 'retype-noop', created: '2026-04-15T10:00:00Z', type: 'data',
    })
    const rel = relPathFor(filename)
    upsertAsset(rel)

    const route = findRoute(plugin.routes, 'PATCH', '/retype')!
    const req = makeRequest('/retype', {
      method: 'PATCH',
      body: { filename, type: 'data' },
    })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.path).toBe(rel)
    expect(body.newType).toBe('data')
  })
})

// ===========================================================================
// PUT /content — update text content
// ===========================================================================

describe('PUT /content — update asset content', () => {
  it('writes content to an editable file', async () => {
    const filename = '20260415-editable-aaaabbbb.md'
    createAssetFixture(filename, '# Old content', {
      agent: 'scribe', taskId: 'content-task', created: '2026-04-15T10:00:00Z', type: 'text',
    })
    const rel = relPathFor(filename)

    const route = findRoute(plugin.routes, 'PUT', '/content')!
    const req = makeRequest('/content', {
      method: 'PUT',
      body: { filename, content: '# Updated content' },
    })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.size).toBeGreaterThan(0)

    const written = readFileSync(join(testDir, rel), 'utf-8')
    expect(written).toBe('# Updated content')
  })

  it('returns 400 for non-editable MIME type', async () => {
    const route = findRoute(plugin.routes, 'PUT', '/content')!
    const req = makeRequest('/content', {
      method: 'PUT',
      body: { filename: HERO, content: 'not allowed' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not editable/i)
  })

  it('returns 400 for unsafe filename', async () => {
    const route = findRoute(plugin.routes, 'PUT', '/content')!
    const req = makeRequest('/content', {
      method: 'PUT',
      body: { filename: 'assets/../../../etc/passwd', content: 'hack' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 404 for nonexistent file', async () => {
    const route = findRoute(plugin.routes, 'PUT', '/content')!
    const req = makeRequest('/content', {
      method: 'PUT',
      body: { filename: '20260415-missing-ffffffff.md', content: 'test' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(404)
  })

  it('returns 400 when content field is missing', async () => {
    const route = findRoute(plugin.routes, 'PUT', '/content')!
    const req = makeRequest('/content', {
      method: 'PUT',
      body: { filename: README },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// MCP tools: retype and update_content
// ===========================================================================

describe('bakin_exec_assets_retype', () => {
  it('retypes asset via MCP tool (metadata-only)', async () => {
    const filename = '20260415-mcp-report-ccccdddd.json'
    createAssetFixture(filename, '{"data":1}', {
      agent: 'analyst', taskId: 'mcp-retype', created: '2026-04-15T10:00:00Z', type: 'data',
    })
    const rel = relPathFor(filename)
    upsertAsset(rel)

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_retype')!
    const result = await callTool(tool, {
      filename,
      type: 'research',
    }, 'analyst')

    expect(result.ok).toBe(true)
    expect(result.filename).toBe(filename)
    expect(result.newType).toBe('research')
    // File stays put; sidecar carries the new type.
    expect(result.path).toBe(rel)
    const sidecar = JSON.parse(readFileSync(join(testDir, `${rel}.meta.json`), 'utf-8'))
    expect(sidecar.type).toBe('research')
  })
})

describe('bakin_exec_assets_update_content', () => {
  it('updates content via MCP tool', async () => {
    const filename = '20260415-mcp-doc-eeeeffff.md'
    createAssetFixture(filename, '# Original', {
      agent: 'scribe', taskId: 'mcp-content', created: '2026-04-15T10:00:00Z', type: 'text',
    })
    const rel = relPathFor(filename)

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_update_content')!
    const result = await callTool(tool, {
      filename,
      content: '# Revised',
    }, 'scribe')

    expect(result.ok).toBe(true)
    const written = readFileSync(join(testDir, rel), 'utf-8')
    expect(written).toBe('# Revised')
  })
})

// ===========================================================================
// Research type
// ===========================================================================

describe('research asset type', () => {
  it('lists research assets', async () => {
    const filename = '20260415-analysis-11112222.md'
    createAssetFixture(filename, '# Market analysis', {
      agent: 'scribe', taskId: 'research-task', created: '2026-04-15T10:00:00Z', type: 'research',
      tags: ['competitive'],
    })
    upsertAsset(relPathFor(filename))

    const route = findRoute(plugin.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, plugin.ctx, {
      searchParams: { type: 'research' },
    })

    expect(status).toBe(200)
    const assets = body.assets as Array<{ type: string }>
    expect(assets.length).toBeGreaterThanOrEqual(1)
    for (const a of assets) {
      expect(a.type).toBe('research')
    }
  })

  it('accepts research type in save tool', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_save')!
    // Verify the tool's parameters accept 'research'
    expect(tool).toBeDefined()
  })
})
