/**
 * B10: assets exec tools on the versioned (assetId) model — list / get / open /
 * delete / link / retype / list_trash / restore / empty_trash /
 * permanent_delete / audit. (save is covered in routes.test.ts.)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { activatePlugin, findTool, callTool, type ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-versioned-exec-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main', tryGetMainAgentId: () => 'main', getMainAgentName: () => 'Main',
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: join(testDir, 'assets') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: join(testDir, 'assets') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/watcher', () => ({ registerSyncHook: mock(), registerUnlinkHook: mock() }))

import assetsPlugin from '@bakin/assets'

/** Hand-build a versioned asset dir (no sharp): manifest + version files. */
function seedVersioned(assetId: string, opts: { type?: string; taskId?: string | null; versions: Array<{ op?: string; text?: string }>; current?: number } = { versions: [{}] }): string {
  const ym = `${assetId.slice(0, 4)}-${assetId.slice(4, 6)}`
  const dir = join(testDir, 'assets', 'store', ym, assetId)
  mkdirSync(dir, { recursive: true })
  const type = opts.type ?? 'text'
  const ext = type === 'images' ? 'png' : 'md'
  const versions = opts.versions.map((v, i) => {
    const n = i + 1
    writeFileSync(join(dir, `v${n}.${ext}`), v.text ?? `version ${n} content`)
    return {
      version: n, file: `v${n}.${ext}`, thumb: null, mimeType: type === 'images' ? 'image/png' : 'text/markdown',
      size: statSync(join(dir, `v${n}.${ext}`)).size, width: null, height: null, created: '2026-05-30T00:00:00Z',
      description: `desc v${n}`, tags: ['t'], op: v.op ?? (n === 1 ? 'generate' : 'edit'),
      parentVersion: n === 1 ? null : n - 1, tool: 'test', prompt: `prompt v${n}`, promptHash: `sha256:v${n}`, generation: null,
    }
  })
  const current = opts.current ?? versions.length
  const cur = versions.find(v => v.version === current)!
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    assetId, type, source: { kind: 'generated', path: null }, agent: 'pixel', taskId: opts.taskId ?? 't1',
    created: '2026-05-30T00:00:00Z', updated: '2026-05-30T00:00:00Z', currentVersion: current,
    description: cur.description, tags: cur.tags, versions, exports: [],
  }, null, 2))
  return assetId
}

let plugin: ActivatedPlugin
beforeAll(async () => { plugin = await activatePlugin(assetsPlugin, testDir) })
beforeEach(() => { rmSync(join(testDir, 'assets'), { recursive: true, force: true }); mkdirSync(join(testDir, 'assets', 'store'), { recursive: true }) })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const tool = (name: string) => findTool(plugin.execTools, name)!

describe('versioned exec tools', () => {
  it('list returns current-version summaries', async () => {
    seedVersioned('20260530-alpha-aaaaaaaa', { versions: [{}, {}, {}] })
    seedVersioned('20260530-beta-bbbbbbbb', { versions: [{}] })
    const r = await callTool(tool('bakin_exec_assets_list'), {}, 'main')
    expect(r.ok).toBe(true)
    expect(r.count).toBe(2)
    const alpha = (r.assets as Array<{ assetId: string; versionCount: number }>).find(a => a.assetId === '20260530-alpha-aaaaaaaa')
    expect(alpha?.versionCount).toBe(3)
  })

  it('get returns the manifest; 404s unknown / invalid', async () => {
    const id = seedVersioned('20260530-gamma-cccccccc', { versions: [{}, {}] })
    const r = await callTool(tool('bakin_exec_assets_get'), { assetId: id }, 'main')
    expect(r.ok).toBe(true)
    expect((r.asset as { currentVersion: number }).currentVersion).toBe(2)
    expect((await callTool(tool('bakin_exec_assets_get'), { assetId: '20260530-ghost-deadbeef' }, 'main')).ok).toBe(false)
    expect((await callTool(tool('bakin_exec_assets_get'), { assetId: 'not-an-id' }, 'main')).ok).toBe(false)
  })

  it('open returns manifest + current text content', async () => {
    const id = seedVersioned('20260530-doc-dddddddd', { type: 'text', versions: [{ text: 'old' }, { text: 'CURRENT BODY' }] })
    const r = await callTool(tool('bakin_exec_assets_open'), { assetId: id }, 'main')
    expect(r.ok).toBe(true)
    expect(String(r.content)).toContain('CURRENT BODY')
  })

  it('delete trashes the asset; list_trash + restore round-trip', async () => {
    const id = seedVersioned('20260530-eps-eeeeeeee', { versions: [{}] })
    const del = await callTool(tool('bakin_exec_assets_delete'), { assetId: id }, 'main')
    expect(del.ok).toBe(true)
    expect((await callTool(tool('bakin_exec_assets_get'), { assetId: id }, 'main')).ok).toBe(false)

    const trash = await callTool(tool('bakin_exec_assets_list_trash'), {}, 'main')
    expect(trash.count).toBe(1)
    const trashName = (trash.items as Array<{ trashName: string }>)[0].trashName

    const restored = await callTool(tool('bakin_exec_assets_restore'), { trashName }, 'main')
    expect(restored.ok).toBe(true)
    expect((await callTool(tool('bakin_exec_assets_get'), { assetId: id }, 'main')).ok).toBe(true)
  })

  it('empty_trash + permanent_delete clear trash', async () => {
    const a = seedVersioned('20260530-ta-aaaa1111', { versions: [{}] })
    const b = seedVersioned('20260530-tb-bbbb2222', { versions: [{}] })
    await callTool(tool('bakin_exec_assets_delete'), { assetId: a }, 'main')
    await callTool(tool('bakin_exec_assets_delete'), { assetId: b }, 'main')
    const trash = await callTool(tool('bakin_exec_assets_list_trash'), {}, 'main')
    const first = (trash.items as Array<{ trashName: string }>)[0].trashName
    expect((await callTool(tool('bakin_exec_assets_permanent_delete'), { trashName: first }, 'main')).ok).toBe(true)
    expect((await callTool(tool('bakin_exec_assets_empty_trash'), {}, 'main')).ok).toBe(true)
    expect((await callTool(tool('bakin_exec_assets_list_trash'), {}, 'main')).count).toBe(0)
  })

  it('link + retype mutate asset-level metadata', async () => {
    const id = seedVersioned('20260530-zeta-ffffffff', { taskId: 'old-task', versions: [{}] })
    expect((await callTool(tool('bakin_exec_assets_link'), { assetId: id, taskId: 'new-task' }, 'main')).ok).toBe(true)
    expect((await callTool(tool('bakin_exec_assets_get'), { assetId: id }, 'main')).asset).toMatchObject({ taskId: 'new-task' })
    expect((await callTool(tool('bakin_exec_assets_retype'), { assetId: id, type: 'research' }, 'main')).ok).toBe(true)
    expect((await callTool(tool('bakin_exec_assets_get'), { assetId: id }, 'main')).asset).toMatchObject({ type: 'research' })
  })

  it('audit reports versioned health results', async () => {
    seedVersioned('20260530-aud-aaaabbbb', { versions: [{}, {}] })
    const r = await callTool(tool('bakin_exec_assets_audit'), {}, 'main')
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.results)).toBe(true)
  })
})
