/**
 * sync-manifest engine (T16): regenerates contributes.apiRoutes/execTools
 * from the plugin's actual surface. Uses skipBuild + hand-written dist
 * bundles so no real build runs; the golden-path integration test covers
 * the built-for-real path.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-sync-manifest-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const bakinPaths = () => ({ root: testDir, db: join(testDir, 'bakin.db'), plugins: join(testDir, 'plugins') })
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: bakinPaths,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: bakinPaths,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('@/core/logger', loggerMock)

import { syncPluginManifest } from '../../src/core/plugin-sync-manifest'

let counter = 0

function writePlugin(opts: {
  manifest?: Record<string, unknown>
  dist: string
}): string {
  counter += 1
  const id = `sync-fixture-${counter}`
  const dir = join(testDir, 'fixtures', `${id}-${randomUUID().slice(0, 8)}`)
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({
    id,
    name: id,
    version: '1.0.0',
    bakin: '>=0.0.0-dev',
    description: 'sync fixture',
    ...opts.manifest,
  }, null, 2))
  writeFileSync(join(dir, 'dist', 'index.js'), opts.dist.replaceAll('__ID__', id))
  return dir
}

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
})

const DIST_WITH_SURFACES = `
const plugin = {
  id: '__ID__',
  name: '__ID__',
  version: '1.0.0',
  routes: [
    { path: '/hello', method: 'GET', summary: 'Say hello', handler: () => new Response('hi') },
    { path: '/legacy', method: 'POST', handler: () => new Response('ok') },
  ],
  activate: function(ctx) {
    // ctx.registerRoute is GONE (T19) — old dist bundles that still call it
    // hit the recording context's no-op proxy and are simply not captured.
    ctx.registerRoute({ path: '/ghost', method: 'POST', handler: () => new Response('ok') })
    ctx.registerExecTool({ name: 'bakin_exec___ID___do', description: 'Do the thing\\nlonger text', parameters: {}, handler: async () => ({ ok: true }) })
    // arbitrary other ctx use must be side-effect-free no-ops:
    ctx.hooks.register('__ID__.thing', async () => ({}))
    ctx.events.emit('x', {})
    ctx.getSettings()
  },
}
module.exports = plugin
module.exports.default = plugin
`

describe('syncPluginManifest', () => {
  it('captures declarative routes and exec tools (legacy registerRoute is a dead no-op); writes with derived summaries', async () => {
    const dir = writePlugin({ dist: DIST_WITH_SURFACES })
    const result = await syncPluginManifest(dir, { skipBuild: true })
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.written).toBe(true)
    expect(result.diff!.apiRoutes.added.sort()).toEqual(['GET /hello', 'POST /legacy'])
    expect(result.diff!.execTools.added.length).toBe(1)

    const manifest = JSON.parse(readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8'))
    expect(manifest.contributes.apiRoutes).toEqual([
      { method: 'GET', path: '/hello', summary: 'Say hello' },
      { method: 'POST', path: '/legacy', summary: 'POST /legacy' },
    ])
    expect(manifest.contributes.execTools[0]).toMatchObject({ summary: 'Do the thing' })

    // The regenerated manifest passes the real parser (enforcement shape).
    const { parsePluginManifest } = await import('../../packages/core/src/plugins/manifest')
    expect(() => parsePluginManifest(manifest)).not.toThrow()
  })

  it('is idempotent: second run reports in-sync and does not rewrite', async () => {
    const dir = writePlugin({ dist: DIST_WITH_SURFACES })
    await syncPluginManifest(dir, { skipBuild: true })
    const before = readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8')
    const again = await syncPluginManifest(dir, { skipBuild: true })
    expect(again.changed).toBe(false)
    expect(again.written).toBe(false)
    expect(readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8')).toBe(before)
  })

  it('check mode reports drift without writing', async () => {
    const dir = writePlugin({ dist: DIST_WITH_SURFACES })
    const before = readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8')
    const result = await syncPluginManifest(dir, { check: true, skipBuild: true })
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.written).toBe(false)
    expect(readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8')).toBe(before)
  })

  it('preserves author metadata on kept entries, drops removed ones, keeps unknown keys', async () => {
    const dir = writePlugin({
      manifest: {
        customTopLevel: { keep: true },
        contributes: {
          apiRoutes: [
            { method: 'GET', path: '/hello', summary: 'Author-written summary', tags: ['docs'] },
            { method: 'GET', path: '/gone', summary: 'No longer in code' },
          ],
          nav: [{ label: 'Untouched', path: '/x' }],
        },
      },
      dist: DIST_WITH_SURFACES,
    })
    const result = await syncPluginManifest(dir, { skipBuild: true })
    expect(result.ok).toBe(true)
    expect(result.diff!.apiRoutes.removed).toEqual(['GET /gone'])

    const manifest = JSON.parse(readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8'))
    const hello = manifest.contributes.apiRoutes.find((r: any) => r.path === '/hello')
    expect(hello).toMatchObject({ summary: 'Author-written summary', tags: ['docs'] })
    expect(manifest.contributes.apiRoutes.some((r: any) => r.path === '/gone')).toBe(false)
    expect(manifest.contributes.nav).toEqual([{ label: 'Untouched', path: '/x' }])
    expect(manifest.customTopLevel).toEqual({ keep: true })
    // Top-level key order preserved: id stays first.
    expect(Object.keys(manifest)[0]).toBe('id')
  })

  it('records the search auto-route when the plugin registers a content type', async () => {
    const dir = writePlugin({
      dist: `
const plugin = {
  id: '__ID__', name: '__ID__', version: '1.0.0',
  activate: function(ctx) {
    ctx.search.registerContentType({ id: 'things', schemaVersion: 1 })
    ctx.search.registerFileBackedContentType({ id: 'other', schemaVersion: 1 })
  },
}
module.exports = plugin
module.exports.default = plugin
`,
    })
    const result = await syncPluginManifest(dir, { skipBuild: true })
    expect(result.ok).toBe(true)
    // Exactly one /search route despite two registrations (mirrors buildSearchAPI).
    expect(result.diff!.apiRoutes.added).toEqual(['GET /search'])
  })

  it('refuses to write when activate() throws', async () => {
    const dir = writePlugin({
      dist: `
const plugin = {
  id: '__ID__', name: '__ID__', version: '1.0.0',
  activate: function() { throw new Error('boom at activation') },
}
module.exports = plugin
module.exports.default = plugin
`,
    })
    const before = readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8')
    const result = await syncPluginManifest(dir, { skipBuild: true })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('boom at activation')
    expect(readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8')).toBe(before)
  })

  it('fails cleanly on a missing manifest', async () => {
    const dir = join(testDir, 'fixtures', `empty-${randomUUID().slice(0, 8)}`)
    mkdirSync(dir, { recursive: true })
    const result = await syncPluginManifest(dir, { skipBuild: true })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('bakin-plugin.json')
  })

  it('refuses to write entries the host loader would reject (route shape)', async () => {
    const dir = writePlugin({
      dist: `
const plugin = {
  id: '__ID__', name: '__ID__', version: '1.0.0',
  routes: [
    { method: 'GET', path: 'stats', handler: () => new Response('x') },
    { method: 'GET', path: '/a/../b', handler: () => new Response('x') },
    { method: 'OPTIONS', path: '/opts', handler: () => new Response('x') },
  ],
  activate: function(ctx) {},
}
module.exports = plugin
module.exports.default = plugin
`,
    })
    const before = readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8')
    const result = await syncPluginManifest(dir, { skipBuild: true })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Refusing to write')
    expect(result.error).toContain('stats')
    expect(result.error).toContain('..')
    expect(result.error).toContain('OPTIONS')
    expect(readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8')).toBe(before)
  })

  it('refuses to write exec tools outside the bakin_exec_<id>_ namespace', async () => {
    const dir = writePlugin({
      dist: `
const plugin = {
  id: '__ID__', name: '__ID__', version: '1.0.0',
  activate: function(ctx) {
    ctx.registerExecTool({ name: 'lead_intel_score', description: 'misnamed', parameters: {}, handler: async () => ({}) })
  },
}
module.exports = plugin
module.exports.default = plugin
`,
    })
    const result = await syncPluginManifest(dir, { skipBuild: true })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('lead_intel_score')
    expect(result.error).toContain('bakin_exec_')
  })

  it('times out a never-settling activate instead of hanging', async () => {
    const dir = writePlugin({
      dist: `
const plugin = {
  id: '__ID__', name: '__ID__', version: '1.0.0',
  activate: function() { return new Promise(() => {}) },
}
module.exports = plugin
module.exports.default = plugin
`,
    })
    const result = await syncPluginManifest(dir, { skipBuild: true, captureTimeoutMs: 250 })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('did not settle')
  })
})
