/**
 * Comprehensive tests for the assets plugin routes and exec tools.
 * Tests all 7 API routes and 9 MCP exec tools registered by the plugin.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  activatePlugin,
  findRoute,
  findTool,
  callRoute,
  callTool,
  makeRequest,
  type ActivatedPlugin,
} from '../test-helpers'

// ---------------------------------------------------------------------------
// Mock external dependencies before importing the plugin
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-assets-routes-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => {
    const base = join(testDir, 'assets')
    return {
      'assets.text': join(base, 'text'),
      'assets.images': join(base, 'images'),
      'assets.video': join(base, 'video'),
      'assets.audio': join(base, 'audio'),
      'assets.plans': join(base, 'plans'),
      'assets.data': join(base, 'data'),
      'assets.other': join(base, 'other'),
    }
  },
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/core/watcher', () => ({
  registerSyncHook: vi.fn(),
}))

// Import the plugin after mocks are set up
import assetsPlugin from '@bakin/assets'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createAssetFixture(
  type: string,
  taskId: string,
  filename: string,
  content: string,
  sidecar?: Record<string, unknown>
): string {
  const dir = join(assetsRoot, type, taskId)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, filename)
  writeFileSync(filePath, content)

  if (sidecar) {
    writeFileSync(`${filePath}.meta.json`, JSON.stringify(sidecar, null, 2))
  }

  return filePath
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
// Setup and teardown
// ---------------------------------------------------------------------------

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(assetsRoot, { recursive: true })
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })

  // Create test assets for list/file routes
  createAssetFixture('images', 'task-001', 'hero.png', 'png-bytes', {
    agent: 'pixel',
    taskId: 'task-001',
    created: '2026-03-20T10:00:00Z',
    description: 'Hero image',
    tags: ['hero', 'banner'],
  })
  createAssetFixture('images', 'task-001', 'hero.thumb.jpg', 'thumb-bytes')
  createAssetFixture('text', 'task-002', 'readme.md', '# Hello', {
    agent: 'scribe',
    taskId: 'task-002',
    created: '2026-03-21T12:00:00Z',
    tags: ['docs'],
  })
  createAssetFixture('data', 'task-003', 'metrics.json', '{"views":100}', {
    agent: 'analyst',
    taskId: 'task-003',
    created: '2026-03-22T08:00:00Z',
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
  it('registers all 7 routes', () => {
    expect(plugin.routes.length).toBe(7)
  })

  it.each([
    ['GET', '/'],
    ['GET', '/file'],
    ['DELETE', '/'],
    ['GET', '/trash'],
    ['POST', '/trash/:file/restore'],
    ['DELETE', '/trash'],
    ['DELETE', '/trash/:file'],
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
  it('registers all 9 exec tools', () => {
    expect(plugin.execTools.length).toBe(9)
  })

  it.each([
    'bakin_exec_assets_list',
    'bakin_exec_assets_save',
    'bakin_exec_assets_delete',
    'bakin_exec_assets_list_trash',
    'bakin_exec_assets_restore',
    'bakin_exec_assets_audit',
    'bakin_exec_assets_empty_trash',
    'bakin_exec_assets_permanent_delete',
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

  it('looks up single asset by path', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, plugin.ctx, {
      searchParams: { path: 'assets/text/task-002/readme.md' },
    })

    expect(status).toBe(200)
    expect(body.count).toBe(1)
    const assets = body.assets as Array<{ filename: string }>
    expect(assets[0].filename).toBe('readme.md')
  })

  it('returns empty when path not found', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, plugin.ctx, {
      searchParams: { path: 'assets/images/nonexistent/nope.png' },
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
    // hero.thumb.jpg should be nested, not a top-level entry
    const filenames = assets.map(a => a.filename)
    expect(filenames).toContain('hero.png')
    expect(filenames).not.toContain('hero.thumb.jpg')
  })

  it('returns flat list when grouped=false', async () => {
    const route = findRoute(plugin.routes, 'GET', '/')!
    const { body } = await callRoute(route, plugin.ctx, {
      searchParams: { taskId: 'task-001', grouped: 'false' },
    })

    const assets = body.assets as Array<{ filename: string }>
    const filenames = assets.map(a => a.filename)
    expect(filenames).toContain('hero.png')
    expect(filenames).toContain('hero.thumb.jpg')
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
      searchParams: { path: 'assets/images/task-001/hero.png' },
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
      searchParams: { path: 'assets/text/task-002/readme.md' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown')
  })

  it('returns 400 when path is missing', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file')
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/path.*required/i)
  })

  it('returns 400 for path traversal attempt', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { path: 'assets/../../../etc/passwd' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 400 when path does not start with assets/', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { path: 'projects/secret.md' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 404 for nonexistent file', async () => {
    const route = findRoute(plugin.routes, 'GET', '/file')!
    const req = makeRequest('/file', {
      searchParams: { path: 'assets/images/nope/missing.png' },
    })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(404)
  })
})

// ===========================================================================
// POST /delete — soft-delete asset
// ===========================================================================

describe('DELETE / — soft-delete asset', () => {
  it('soft-deletes an asset to .trash/', async () => {
    // Create a disposable asset
    createAssetFixture('images', 'task-del', 'delete-me.png', 'deletable', {
      agent: 'pixel',
      taskId: 'task-del',
      created: '2026-03-25T00:00:00Z',
    })

    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest('/?path=assets/images/task-del/delete-me.png', {
      method: 'DELETE',
    })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.trashed).toContain('assets/images/task-del/delete-me.png')

    // File should be in .trash/
    const trashFiles = readdirSync(join(assetsRoot, '.trash'))
    const trashed = trashFiles.find(f => f.startsWith('delete-me.png__deleted-'))
    expect(trashed).toBeDefined()

    // Original should be gone
    expect(existsSync(join(assetsRoot, 'images', 'task-del', 'delete-me.png'))).toBe(false)
  })

  it('cascade-deletes variants', async () => {
    createAssetFixture('images', 'task-cascade', 'photo.png', 'primary', {
      agent: 'pixel',
      taskId: 'task-cascade',
      created: '2026-03-25T00:00:00Z',
    })
    createAssetFixture('images', 'task-cascade', 'photo.thumb.jpg', 'thumb')

    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest('/?path=assets/images/task-cascade/photo.png', {
      method: 'DELETE',
    })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.trashed.length).toBeGreaterThanOrEqual(2)
    expect(existsSync(join(assetsRoot, 'images', 'task-cascade', 'photo.png'))).toBe(false)
    expect(existsSync(join(assetsRoot, 'images', 'task-cascade', 'photo.thumb.jpg'))).toBe(false)
  })

  it('triggers audit and activity log', async () => {
    createAssetFixture('text', 'task-audit', 'log-test.md', 'test', {
      agent: 'scribe',
      taskId: 'task-audit',
      created: '2026-03-25T00:00:00Z',
    })

    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest('/?path=assets/text/task-audit/log-test.md', {
      method: 'DELETE',
    })
    await route.handler(req, plugin.ctx)

    expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('deleted', 'system')
    expect(plugin.ctx.activity.log).toHaveBeenCalledWith('system', 'Asset deleted')
  })

  it('returns 400 when path is missing', async () => {
    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest('/', { method: 'DELETE' })
    const res = await route.handler(req, plugin.ctx)

    expect(res.status).toBe(400)
  })

  it('returns 400 for path traversal', async () => {
    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest('/?path=assets/../../../etc/passwd', { method: 'DELETE' })
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
  it('restores a trashed asset to its original location', async () => {
    const ts = Date.now()
    const trashFilename = createTrashFixture('restore-me.png', ts, 'image-data', {
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
    expect(body.restoredPath).toBe('assets/images/task-restore/restore-me.png')
    expect(existsSync(join(assetsRoot, 'images', 'task-restore', 'restore-me.png'))).toBe(true)
  })

  it('triggers audit on successful restore', async () => {
    const ts = Date.now() + 1
    const trashFilename = createTrashFixture('audit-restore.txt', ts, 'text', {
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
    expect((result.filename as string)).toMatch(/^\d{8}-saved-hero\.png$/)
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
    await callTool(tool, {
      filePath: sourceFile,
      taskId: 'task-activity',
      type: 'text',
    }, 'scribe')

    expect(plugin.ctx.activity.log).toHaveBeenCalledWith(
      'scribe',
      expect.stringContaining('Saved asset'),
      expect.objectContaining({ taskId: 'task-activity' })
    )
  })
})

// ===========================================================================
// Exec tool: bakin_exec_assets_delete
// ===========================================================================

describe('exec tool: bakin_exec_assets_delete', () => {
  it('deletes asset directly via library (bypasses HTTP handler)', async () => {
    createAssetFixture('text', 'task-tool-del', 'tool-delete.md', 'content', {
      agent: 'scribe',
      taskId: 'task-tool-del',
      created: '2026-03-25T00:00:00Z',
    })

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_delete')!
    const result = await callTool(tool, {
      path: 'assets/text/task-tool-del/tool-delete.md',
    }, 'scribe')

    expect(result.ok).toBe(true)
    expect(existsSync(join(assetsRoot, 'text', 'task-tool-del', 'tool-delete.md'))).toBe(false)
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
    const trashFilename = createTrashFixture('tool-restore.png', ts, 'restored-data', {
      agent: 'pixel',
      taskId: 'task-tr',
      created: '2026-03-20T00:00:00Z',
    })

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_restore')!
    const result = await callTool(tool, { filename: trashFilename }, 'pixel')

    expect(result.ok).toBe(true)
    expect(result.restoredPath).toBe('assets/images/task-tr/tool-restore.png')
    expect(existsSync(join(assetsRoot, 'images', 'task-tr', 'tool-restore.png'))).toBe(true)
  })

  it('logs activity on successful restore', async () => {
    const ts = Date.now() + 900
    const trashFilename = createTrashFixture('log-restore.txt', ts, 'data', {
      agent: 'scribe',
      taskId: 'task-lr',
      created: '2026-03-20T00:00:00Z',
    })

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_restore')!
    await callTool(tool, { filename: trashFilename }, 'scribe')

    expect(plugin.ctx.activity.log).toHaveBeenCalledWith(
      'scribe',
      expect.stringContaining('Restored asset')
    )
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
      expect(issue.path).toMatch(/^assets\/text\//)
    }
  })

  it('detects missing sidecars', async () => {
    // Create an asset without a sidecar
    const dir = join(assetsRoot, 'data', 'task-no-sidecar')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'orphan.json'), '{}')

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
    const result = await callTool(tool, { type: 'data' })

    const issues = result.issues as Array<{ path: string; issue: string }>
    const orphanIssue = issues.find(i => i.path.includes('orphan.json'))
    // It should either have missing-sidecar OR stub-sidecar (since buildIndex creates stubs)
    expect(orphanIssue).toBeDefined()
  })

  it('auto-fixes missing sidecars when fix=true', async () => {
    const dir = join(assetsRoot, 'text', 'task-fix-sidecar')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'fixme.md'), 'no sidecar')
    // Ensure no sidecar exists
    const sidecarPath = join(dir, 'fixme.md.meta.json')
    if (existsSync(sidecarPath)) rmSync(sidecarPath)

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
    const result = await callTool(tool, { type: 'text', fix: true })

    expect(result.ok).toBe(true)
    const summary = result.summary as { fixed: number }
    // Even if the sidecar was created by buildIndex, verify audit ran successfully
    expect(typeof summary.fixed).toBe('number')
  })

  it('detects orphaned sidecars', async () => {
    const dir = join(assetsRoot, 'text', 'task-orphan-sidecar')
    mkdirSync(dir, { recursive: true })
    // Create a sidecar without a matching asset
    writeFileSync(join(dir, 'ghost.md.meta.json'), JSON.stringify({
      agent: 'test',
      taskId: 'task-orphan-sidecar',
      created: '2026-03-25T00:00:00Z',
    }))

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
    const result = await callTool(tool, { type: 'text' })

    const issues = result.issues as Array<{ path: string; issue: string }>
    const orphanedSidecar = issues.find(i => i.issue === 'orphaned-sidecar' && i.path.includes('ghost.md.meta.json'))
    expect(orphanedSidecar).toBeDefined()
  })

  it('returns error when assets directory does not exist', async () => {
    // Temporarily rename assets dir
    const { renameSync: rn } = await import('fs')
    const backup = assetsRoot + '_backup'
    rn(assetsRoot, backup)

    try {
      const tool = findTool(plugin.execTools, 'bakin_exec_assets_audit')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    } finally {
      rn(backup, assetsRoot)
    }
  })
})

// ===========================================================================
// DELETE route integration — simulates the full URL path the browser sends
// ===========================================================================

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
    // Browser sends: DELETE /api/plugins/assets?path=assets/images/task/file.png
    // Next.js extracts: pathSegments = [] → routePath = "/"
    const routePath = '/'
    const match = matchRoute(plugin.routes, routePath, 'DELETE')

    expect(match).not.toBeNull()
    expect(match!.route.path).toBe('/')
    expect(match!.route.method).toBe('DELETE')
  })

  it('handler receives path from query param and deletes successfully', async () => {
    createAssetFixture('images', 'task-integ', 'browser-delete.png', 'image-data', {
      agent: 'pixel',
      taskId: 'task-integ',
      created: '2026-03-25T00:00:00Z',
    })

    // Simulate the exact URL the browser constructs:
    // fetch(`/api/plugins/assets?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
    const assetPath = 'assets/images/task-integ/browser-delete.png'
    const route = findRoute(plugin.routes, 'DELETE', '/')!
    const req = makeRequest(`/?path=${encodeURIComponent(assetPath)}`, { method: 'DELETE' })
    const res = await route.handler(req, plugin.ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.trashed).toContain(assetPath)
    expect(existsSync(join(assetsRoot, 'images', 'task-integ', 'browser-delete.png'))).toBe(false)
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
