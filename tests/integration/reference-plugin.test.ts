/**
 * Reference-plugin gate: examples/reference-plugin is the canonical template
 * external authors copy — this test installs it through the REAL pipeline
 * (copy → buildUserPlugin → registry activation) and drives every contributed
 * surface, so the template can never drift from the host.
 *
 * Pattern and network-free plumbing mirror plugin-golden-path.test.ts: zod is
 * rewired to the repo's own node_modules via `file:`, devDependencies (which
 * exist for standalone typechecking) are dropped, and the server bundle
 * inlines @makinbakin/sdk from repo source.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-reference-plugin-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const REPO_ROOT = resolve(import.meta.dir, '../..')
const PLUGIN_ID = 'reference-bookmarks'

const bakinPaths = () => ({
  root: testDir,
  db: join(testDir, 'bakin.db'),
  plugins: join(testDir, 'plugins'),
  pluginData: join(testDir, 'plugin-data'),
  pluginSettings: join(testDir, 'plugin-settings'),
})

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: bakinPaths,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
const coreContentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: bakinPaths,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
})
mock.module('../../packages/core/src/content-dir', coreContentDirMock)
mock.module('@bakin/core/content-dir', coreContentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))
mock.module('../../src/core/api-docs', () => ({
  registerRouteDoc: mock(),
  removeRouteDocsByPlugin: () => 0,
}))
mock.module('../../src/core/migrations', () => ({
  runMigrations: mock().mockResolvedValue(0),
}))
mock.module('../../src/core/watcher', () => ({
  registerSyncHook: mock(() => () => {}),
  registerUnlinkHook: mock(() => () => {}),
  shouldIgnoreContentWatcherPath: () => false,
  start: mock(),
  stop: mock(),
}))

describe('reference plugin (install → activate → every surface)', () => {
  let pluginRegistry: any
  let getExecTool: any
  let getToolContext: any
  let handlePluginRoute: (req: Request, url: URL) => Promise<Response>

  beforeAll(async () => {
    mkdirSync(testDir, { recursive: true })

    const { createMockRuntimeAdapter } = await import('@bakin/core/adapters/runtime/testing')
    const { createMockSearchAdapter } = await import('@bakin/core/adapters/search/testing')
    const { createMockBakinTaskStore } = await import('@bakin/core/tasks/testing')
    const runtime = createMockRuntimeAdapter()
    const search = createMockSearchAdapter()
    ;(globalThis as any).__bakinAppServices = {
      runtime,
      search,
      tasks: createMockBakinTaskStore(),
    }

    // --- install: copy examples/reference-plugin like commit.ts does ---
    const targetDir = join(testDir, 'plugins', PLUGIN_ID)
    mkdirSync(join(testDir, 'plugins'), { recursive: true })
    cpSync(join(REPO_ROOT, 'examples', 'reference-plugin'), targetDir, {
      recursive: true,
      dereference: false,
      filter: (src) => !src.includes('node_modules') && !src.includes('/dist'),
    })

    // Network-free plumbing (see module doc).
    const pkgPath = join(targetDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.dependencies = { zod: `file:${join(REPO_ROOT, 'node_modules', 'zod')}` }
    delete pkg.devDependencies
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

    const { buildUserPlugin } = await import('../../packages/host/src/plugin-host/user-plugin-builder')
    await buildUserPlugin(targetDir)

    const reg = await import('../../src/core/plugin-registry')
    pluginRegistry = reg.pluginRegistry
    pluginRegistry._resetForTests()
    reg.registerCorePlugins({})
    const storage = { read: mock(), write: mock(), append: mock(), exists: mock(), readAll: mock() }
    const events = { emit: mock(), on: mock(), once: mock() }
    await pluginRegistry.initialize({ plugins: [] }, storage, events)

    const execTools = await import('../../src/core/exec-tools/registry')
    getExecTool = execTools.getExecTool
    getToolContext = execTools.getToolContext

    const catchAll = await import('../../packages/host/src/api/plugins/[pluginId]/[[...path]]')
    handlePluginRoute = catchAll.get
  }, 120_000)

  afterAll(() => {
    pluginRegistry?._resetForTests?.()
    delete (globalThis as any).__bakinAppServices
    rmSync(testDir, { recursive: true, force: true })
  })

  it('builds and activates against manifest enforcement', () => {
    expect(existsSync(join(testDir, 'plugins', PLUGIN_ID, 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(testDir, 'plugins', PLUGIN_ID, 'dist', 'client.js'))).toBe(true)
    const entry = pluginRegistry
      .getRegistrySnapshot()
      .find((e: any) => e.id === PLUGIN_ID)
    expect(entry).toMatchObject({ status: 'active' })
  })

  it('create → list → delete through the real dispatch path', async () => {
    const base = `http://localhost/api/plugins/${PLUGIN_ID}`

    const postUrl = new URL(`${base}/`)
    const created = await handlePluginRoute(
      new Request(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://bun.sh', title: 'Bun', tags: ['runtime'] }),
      }),
      postUrl,
    )
    expect(created.status).toBe(201)
    const { bookmark } = (await created.json()) as { bookmark: { id: string } }

    const listUrl = new URL(`${base}/?tag=runtime`)
    const listed = await handlePluginRoute(new Request(listUrl), listUrl)
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as any).bookmarks).toHaveLength(1)

    const delUrl = new URL(`${base}/${bookmark.id}`)
    const removed = await handlePluginRoute(new Request(delUrl, { method: 'DELETE' }), delUrl)
    expect(removed.status).toBe(200)
  })

  it('exec tool is registered and callable with real scoped storage', async () => {
    const toolName = `bakin_exec_${PLUGIN_ID}_save`
    const tool = getExecTool(toolName)
    expect(tool).toBeDefined()
    const result = await tool.handler(
      { url: 'https://example.com', title: 'Example' },
      'test-agent',
      getToolContext(toolName),
    )
    expect(result).toMatchObject({ ok: true })

    const listUrl = new URL(`http://localhost/api/plugins/${PLUGIN_ID}/`)
    const listed = await handlePluginRoute(new Request(listUrl), listUrl)
    const titles = ((await listed.json()) as any).bookmarks.map((b: any) => b.title)
    expect(titles).toContain('Example')
  })

  it('registers its search content type and health check', async () => {
    // Registry keys are prefixed physical table names — look up by owner.
    const { getContentTypes } = await import('../../src/core/search-registry')
    const contentType = [...getContentTypes().values()].find((c) => c.pluginId === PLUGIN_ID)
    expect(contentType).toBeDefined()
    expect(contentType!.table).toBe(PLUGIN_ID)

    const { listHealthChecks } = await import('../../src/core/health-check-registry')
    expect(listHealthChecks().some((c: any) => c.id === `${PLUGIN_ID}.store-integrity`)).toBe(true)
  })

  it('manifest contributes are in sync with the code (sync-manifest --check)', async () => {
    const { syncPluginManifest } = await import('../../src/core/plugin-sync-manifest')
    const check = await syncPluginManifest(join(testDir, 'plugins', PLUGIN_ID), {
      check: true,
      skipBuild: true,
    })
    expect(check.ok).toBe(true)
    expect(check.changed).toBe(false)
  })

  it('imports only the published SDK surface', () => {
    // The template must not reach into Bakin internals — @makinbakin/sdk/*
    // is the entire authoring API. Scan actual import/require specifiers
    // (not raw text, which also matches comments) for every escape hatch:
    // @bakin/*, the @/ alias, packages/host|core, and relative escapes out
    // of the example tree.
    const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs')
    const root = join(REPO_ROOT, 'examples', 'reference-plugin')
    const offenders: string[] = []
    const forbidden = /^(@bakin\/|@\/)|(?:^|\/)packages\/(host|core)|^\.\.\/\.\.\//
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(entry)) continue
        const src = readFileSync(full, 'utf-8')
        for (const m of src.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)) {
          if (forbidden.test(m[1])) offenders.push(`${full}: ${m[1]}`)
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
