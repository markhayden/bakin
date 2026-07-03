/**
 * Assets plugin route + exec-tool registration and the surviving HTTP surface.
 *
 * The filename-era routes (GET / · GET /file · DELETE / · /link · /retype ·
 * /content · /trash*) were removed in the versioned cutover. The asset-as-
 * directory model is served by the host /api/assets/<assetId> route (see
 * serve.test.ts) and mutated through /versioned/* (see versioned-routes.test.ts
 * + versioned-exec-tools.test.ts). This file covers what assets/index.ts still
 * registers: the upload route, the versioned routes, the exec tools, and the
 * auto-wired /search route.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  activatePlugin,
  findRoute,
  findTool,
  callTool,
  callSearchRoute,
  type ActivatedPlugin,
} from '../test-helpers'

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

import assetsPlugin from '@bakin/assets'

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(join(assetsRoot, 'store'), { recursive: true })
  plugin = await activatePlugin(assetsPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ===========================================================================
// Route registration
// ===========================================================================

describe('route registration', () => {
  it('registers all 20 routes', () => {
    expect(plugin.routes.length).toBe(20)
  })

  it.each([
    ['GET', '/import/scan'],
    ['POST', '/import'],
    ['POST', '/upload'],
    ['GET', '/versioned'],
    ['GET', '/versioned/:assetId'],
    ['POST', '/versioned/:assetId/promote'],
    ['DELETE', '/versioned/:assetId/v/:version'],
    ['POST', '/versioned/:assetId/export'],
    ['PATCH', '/versioned/:assetId/metadata'],
    ['POST', '/versioned/:assetId/relink'],
    ['POST', '/versioned/:assetId/version'],
    ['DELETE', '/versioned/:assetId'],
    ['POST', '/tags/rename'],
    ['POST', '/tags/remove'],
    ['POST', '/tags/apply'],
    ['GET', '/trash'],
    ['POST', '/trash/:trashName/restore'],
    ['DELETE', '/trash/:trashName'],
    ['DELETE', '/trash'],
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
  it('registers all 14 exec tools', () => {
    expect(plugin.execTools.length).toBe(14)
  })

  it.each([
    'bakin_exec_assets_list',
    'bakin_exec_assets_get',
    'bakin_exec_assets_open',
    'bakin_exec_assets_save',
    'bakin_exec_assets_delete',
    'bakin_exec_assets_link',
    'bakin_exec_assets_list_trash',
    'bakin_exec_assets_restore',
    'bakin_exec_assets_audit',
    'bakin_exec_assets_empty_trash',
    'bakin_exec_assets_permanent_delete',
    'bakin_exec_assets_retype',
  ])('registers tool: %s', (name) => {
    const tool = findTool(plugin.execTools, name)
    expect(tool).toBeDefined()
    expect(typeof tool!.handler).toBe('function')
  })
})

describe('exec tool: bakin_exec_assets_list', () => {
  it('filters assets by task id', async () => {
    const save = findTool(plugin.execTools, 'bakin_exec_assets_save')!
    const list = findTool(plugin.execTools, 'bakin_exec_assets_list')!
    const a = join(testDir, 'task-a-note.md')
    const b = join(testDir, 'task-b-note.md')
    writeFileSync(a, 'task a')
    writeFileSync(b, 'task b')

    await callTool(save, { filePath: a, taskId: 'task-list-a', type: 'text', slug: 'task-a-note' }, 'margo')
    await callTool(save, { filePath: b, taskId: 'task-list-b', type: 'text', slug: 'task-b-note' }, 'margo')
    const result = await callTool(list, { taskId: 'task-list-a' }, 'margo')

    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    expect((result.assets as Array<{ taskId: string }>).map(asset => asset.taskId)).toEqual(['task-list-a'])
  })
})

// ===========================================================================
// Exec tool: bakin_exec_assets_save (source → versioned asset, upsert on re-save)
// ===========================================================================

describe('exec tool: bakin_exec_assets_save', () => {
  it('saves a new source file as a versioned asset (v1)', async () => {
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
    expect((result.assetId as string)).toMatch(/^\d{8}-saved-hero-[0-9a-f]{8}$/)
    expect(result.version).toBe(1)
    expect(result.changed).toBe(true)

    // Tags land on the asset (asset-level namespace), normalized.
    const getTool = findTool(plugin.execTools, 'bakin_exec_assets_get')!
    const fetched = await callTool(getTool, { assetId: result.assetId }, 'pixel')
    expect((fetched.asset as { tags: string[] }).tags).toEqual(['test', 'save'])
  })

  it('normalizes caller tags on save', async () => {
    const sourceFile = join(testDir, 'source-tagged.png')
    writeFileSync(sourceFile, 'tagged-bytes')

    const tool = findTool(plugin.execTools, 'bakin_exec_assets_save')!
    const result = await callTool(tool, {
      filePath: sourceFile, taskId: 'task-save-002', type: 'images',
      tags: ['Hello World', 'MIXED case', 'hello-world'],
    }, 'pixel')
    expect(result.ok).toBe(true)

    const getTool = findTool(plugin.execTools, 'bakin_exec_assets_get')!
    const fetched = await callTool(getTool, { assetId: result.assetId }, 'pixel')
    expect((fetched.asset as { tags: string[] }).tags).toEqual(['hello-world', 'mixed-case'])
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

  it('versions the existing asset when the same source is re-saved with new content', async () => {
    const sourceFile = join(testDir, 'evolving-doc.md')
    writeFileSync(sourceFile, '# v1\n')
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_save')!

    const first = await callTool(tool, { filePath: sourceFile, taskId: 't', type: 'text', slug: 'doc' }, 'margo')
    expect(first.version).toBe(1)
    expect(first.changed).toBe(true)

    writeFileSync(sourceFile, '# v2 — changed\n')
    const second = await callTool(tool, { filePath: sourceFile, taskId: 't', type: 'text', slug: 'doc' }, 'margo')
    expect(second.assetId).toBe(first.assetId) // same asset, not a duplicate
    expect(second.version).toBe(2)
    expect(second.changed).toBe(true)
  })

  it('no-ops when the same source is re-saved with identical content', async () => {
    const sourceFile = join(testDir, 'static-doc.md')
    writeFileSync(sourceFile, 'unchanged content')
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_save')!

    const a = await callTool(tool, { filePath: sourceFile, taskId: 't', type: 'text' }, 'margo')
    const b = await callTool(tool, { filePath: sourceFile, taskId: 't', type: 'text' }, 'margo')
    expect(b.assetId).toBe(a.assetId)
    expect(b.version).toBe(1)
    expect(b.changed).toBe(false)
  })

  it('accepts the research type', async () => {
    const sourceFile = join(testDir, 'analysis.md')
    writeFileSync(sourceFile, '# Market analysis')
    const tool = findTool(plugin.execTools, 'bakin_exec_assets_save')!
    const result = await callTool(tool, {
      filePath: sourceFile, taskId: 'research-task', type: 'research', slug: 'analysis',
    }, 'scribe')
    expect(result.ok).toBe(true)
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
          id: '20260320-hero-a1b2c3d4',
          table: 'bakin_assets',
          score: 0.92,
          fields: { file_name: 'v1.png', asset_type: 'images', agent: 'pixel' },
        },
        {
          id: '20260321-readme-b2c3d4e5',
          table: 'bakin_assets',
          score: 0.71,
          fields: { file_name: 'v1.md', asset_type: 'text', agent: 'scribe' },
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
    expect(results[0].id).toBe('20260320-hero-a1b2c3d4')
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
    expect(body.error).toBe('invalid input')
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
