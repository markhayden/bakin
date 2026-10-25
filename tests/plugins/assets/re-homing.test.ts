/**
 * Re-homing table rows 172–188 (assets.assets): store-shape repairs
 * self-heal, the trash purge is the one-click item of the same action, a
 * broken asset record is the operator's decision on its recover page, and
 * everything else is an observation.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-assets-rehoming-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}), isUsingBakinHome: () => true })
mock.module('@/core/content-dir', contentDirMock)
mock.module('@bakin/core/content-dir', contentDirMock)
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const openclawMock = () => ({ getOpenClawHome: () => pathJoin(testDir, 'openclaw'), getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts), resetOpenClawHome: () => {} })
mock.module('@bakin/adapter-openclaw/home', openclawMock)
mock.module('../../../packages/adapter-openclaw/src/home', openclawMock)
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

import { ASSETS_INCIDENTS, assetRepair, assetUsageFromContext, checkAssets, type AssetUsageLookup } from '../../../plugins/assets/lib/health-checks'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'
import { stampPlanItems } from '../../helpers/repair-contract'

const assetsRoot = join(testDir, 'assets')
const storeDir = join(assetsRoot, 'store', '2026-03')
const family = (id: string) => ASSETS_INCIDENTS.find((d) => d.id === id)
async function observations(usage?: AssetUsageLookup) {
  const parsed = parseHealthCheckRunInput(await checkAssets(testDir, usage))
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}
/** The usage facts as the plugin builds them from its context: an open task through the manifest, brands through their hook. */
function usageWith(input: { openTasks?: string[]; brands?: Record<string, Array<{ brandId: string; where: string }>>; brandsHook?: boolean; tasksThrow?: boolean }): AssetUsageLookup {
  return assetUsageFromContext({
    tasks: { get: async (id) => { if (input.tasksThrow) throw new Error('task store down'); return (input.openTasks ?? []).includes(id) ? { id, title: `Task ${id}`, column: 'todo' } : { id, title: `Task ${id}`, column: 'done' } } },
    hooks: {
      has: (name) => name === 'brands.assetReferences' && input.brandsHook !== false,
      invoke: async <R,>(_name: string, data: unknown) => ({ byAsset: Object.fromEntries(((data as { assetIds: string[] }).assetIds).map((id) => [id, input.brands?.[id] ?? []])) }) as R,
    },
  })
}
function seedTree() {
  mkdirSync(storeDir, { recursive: true })
  mkdirSync(join(assetsRoot, 'inbox'), { recursive: true })
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
}
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }) })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('assets re-homing — catalog', () => {
  it('rows 172/173/185 repair through repair-store; 174/180–182 are decisions; the rest are observations', () => {
    expect(family('store-missing')).toMatchObject({ subjectKind: 'record', resolution: { type: 'repair', actionId: 'repair-store' }, required: 'always' })
    expect(family('directory-missing')).toMatchObject({ resolution: { type: 'repair', actionId: 'repair-store' }, required: 'always' })
    expect(family('directory-invalid')).toMatchObject({ resolution: { type: 'human', needs: 'decision' }, required: 'always' })
    for (const id of ['manifest-missing', 'current-version', 'version-file']) {
      expect(family(id)).toMatchObject({ subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' })
    }
    expect(family('expired-trash')).toMatchObject({ resolution: { type: 'repair', actionId: 'repair-store' }, required: 'never' })
    expect(ASSETS_INCIDENTS).toHaveLength(7)
    expect(assetRepair(testDir).effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false })
  })
})

describe('assets re-homing — emitted instances', () => {
  it('rows 172/173: missing store and directories are required self-heal repairs', async () => {
    const missing = (await observations()).find((r) => r.key === 'store-missing')!
    expect(missing.incident).toMatchObject({ declarationId: 'store-missing', subject: { kind: 'record', id: 'assets' }, resolution: { type: 'repair', actionId: 'repair-store' } })
    const action = assetRepair(testDir)
    expect(stampPlanItems(action, await action.plan({ type: 'all_actionable', reportId: 'r' }))[0]!.mode).toBe('self-heal')
    mkdirSync(assetsRoot, { recursive: true })
    const dirs = (await observations()).filter((r) => r.key.startsWith('directory-missing-'))
    expect(dirs).toHaveLength(3)
    expect(dirs[0]!.incident).toMatchObject({ declarationId: 'directory-missing', resolution: { type: 'repair', actionId: 'repair-store' } })
  })
  it('row 174: a required location that is not a directory is the operator\'s decision — the card\'s one choice moves the file aside', async () => {
    seedTree()
    rmSync(join(assetsRoot, 'inbox'), { recursive: true })
    writeFileSync(join(assetsRoot, 'inbox'), 'not a dir')
    const row = (await observations()).find((r) => r.key === 'directory-invalid-inbox')!
    expect(row.incident).toMatchObject({
      declarationId: 'directory-invalid', subject: { kind: 'record', id: 'assets/inbox' }, disposition: 'action_required',
      resolution: {
        type: 'human', needs: 'decision', href: '/assets',
        choices: [{ key: 'move-aside', kind: 'request', method: 'POST', url: '/api/plugins/assets/recover/store-location', body: { location: 'inbox' }, confirm: { title: 'Move assets/inbox aside?' } }],
      },
    })
  })
  it('rows 180–182: broken records land on their recover page, REQUIRED only while an open task or a brand still references them; row 183 (thumbnail) is an observation', async () => {
    seedTree()
    mkdirSync(join(storeDir, '20260323-nomanifest-a1b2c3d4'), { recursive: true })
    const broken = join(storeDir, '20260323-broken-b2c3d4e5')
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, 'manifest.json'), JSON.stringify({
      assetId: '20260323-broken-b2c3d4e5', type: 'images', source: { kind: 'generated', path: null }, agent: 'pixel', taskId: 'task-open', created: 'c', updated: 'c',
      currentVersion: 2, description: '', tags: [],
      versions: [{ version: 1, file: 'v1.png', thumb: 'v1.thumb.png', mimeType: 'image/png', size: 5, width: null, height: null, created: 'c', description: '', tags: [], op: 'generate', parentVersion: null, tool: null, prompt: null, promptHash: null, generation: null }],
      exports: [],
    }))
    // In use: the broken record's task is open (through the manifest's taskId) or a brand still names it.
    const rows = await observations(usageWith({ openTasks: ['task-open'], brands: { '20260323-nomanifest-a1b2c3d4': [{ brandId: 'acme', where: 'logo (dark)' }] } }))
    expect(rows.find((r) => r.key === 'manifest-missing-20260323-nomanifest-a1b2c3d4')!.incident).toMatchObject({ declarationId: 'manifest-missing', required: true, subject: { kind: 'record', id: 'assets/20260323-nomanifest-a1b2c3d4' }, resolution: { type: 'human', needs: 'decision', href: '/assets/20260323-nomanifest-a1b2c3d4?recover=1' } })
    expect(rows.find((r) => r.key === 'current-version-20260323-broken-b2c3d4e5')!.incident).toMatchObject({ declarationId: 'current-version', required: true, resolution: { type: 'human', needs: 'decision', href: '/assets/20260323-broken-b2c3d4e5?recover=1' } })
    expect(rows.find((r) => r.key === 'version-file-20260323-broken-b2c3d4e5-1')!.incident).toMatchObject({ declarationId: 'version-file', required: true, resolution: { type: 'human', needs: 'decision', href: '/assets/20260323-broken-b2c3d4e5?recover=1' } })
    const thumb = rows.find((r) => r.key === 'thumbnail-20260323-broken-b2c3d4e5-1')!
    expect(thumb.status).toBe('warning')
    expect(thumb.incident).toBeUndefined()
    for (const key of ['current-version-20260323-broken-b2c3d4e5', 'version-file-20260323-broken-b2c3d4e5-1']) {
      expect(rows.find((r) => r.key === key)!.incident).toMatchObject({ required: true, disposition: 'action_required' })
      expect(rows.find((r) => r.key === key)!.evidence).toMatchObject({ inUse: true, referencedBy: 'task:task-open', usageKnown: true })
    }

    // NOT in use: the task is closed and no brand names the asset — the same records are advisory.
    const unused = await observations(usageWith({ openTasks: [] }))
    for (const key of ['manifest-missing-20260323-nomanifest-a1b2c3d4', 'current-version-20260323-broken-b2c3d4e5', 'version-file-20260323-broken-b2c3d4e5-1']) {
      expect(unused.find((r) => r.key === key)!.incident).toMatchObject({ required: false, disposition: 'advisory', resolution: { type: 'human', needs: 'decision' } })
    }
    expect(unused.find((r) => r.key === 'current-version-20260323-broken-b2c3d4e5')!.evidence).toMatchObject({ inUse: false, referencedBy: 'none' })

    // No usage fact at all (no task store, no brands plugin): nothing is claimed — advisory, usageKnown false.
    const blind = await observations()
    expect(blind.find((r) => r.key === 'current-version-20260323-broken-b2c3d4e5')!.incident).toMatchObject({ required: false, disposition: 'advisory' })
    expect(blind.find((r) => r.key === 'current-version-20260323-broken-b2c3d4e5')!.evidence).toMatchObject({ inUse: false, usageKnown: false })
    // A throwing task store never invents urgency either, and says the fact is missing.
    const throwing = await observations(usageWith({ tasksThrow: true }))
    expect(throwing.find((r) => r.key === 'current-version-20260323-broken-b2c3d4e5')!.evidence).toMatchObject({ inUse: false, usageKnown: false })
  })
  it('row 185: expired trash is an advisory incident whose repair item is one-click (deletes); rows 176/178/186 are observations', async () => {
    seedTree()
    mkdirSync(join(assetsRoot, 'images'), { recursive: true })
    mkdirSync(join(assetsRoot, 'store', 'not-a-shard'), { recursive: true })
    writeFileSync(join(assetsRoot, 'inbox', 'dropped.png'), 'x')
    const old = join(assetsRoot, '.trash', 'ancient.bin')
    writeFileSync(old, 'old')
    const ago = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(old, ago, ago)
    const rows = await observations()
    expect(rows.find((r) => r.key === 'expired-trash')!.incident).toMatchObject({ declarationId: 'expired-trash', disposition: 'advisory', resolution: { type: 'repair', actionId: 'repair-store' } })
    for (const key of ['unexpected-root-images', 'invalid-shard-not-a-shard', 'unimported']) {
      const row = rows.find((r) => r.key === key)!
      expect(row.status).toBe('warning')
      expect(row.incident).toBeUndefined()
    }
    const action = assetRepair(testDir)
    const items = stampPlanItems(action, await action.plan({ type: 'all_actionable', reportId: 'r' }))
    expect(items[0]).toMatchObject({ mode: 'one-click', effects: { deletesUserContent: true } })
  })
})
