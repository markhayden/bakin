/**
 * Brand recovery (self-healing PR1 slice 1.4a; re-homing row 189): the
 * operator detaches dangling asset references from a brand on
 * `/brands/<id>?recover=1`; the integrity incident points there when one
 * brand is affected.
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-brand-detach-${Date.now()}-${randomUUID()}`)
const paths = () => ({ home: testDir, brands: join(testDir, 'brands'), db: join(testDir, 'bakin.db') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))
mock.module('../../../src/core/agent-cost', () => ({ meterAgentTurn: async () => {}, meterImageTurn: async () => {} }))

import brandsPlugin from '../../../plugins/brands'
import { checkBrandsIntegrity } from '../../../plugins/brands/lib/health-checks'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'

let activated: ActivatedPlugin
const route = (method: string, path: string) => {
  const r = findRoute(activated.routes, method, path)
  if (!r) throw new Error(`route not found: ${method} ${path}`)
  return r
}
const existing = new Set(['kept'])
/** The task store as the check sees it: open tasks by brand (the usage fact), plus done history that never counts. */
let tasks: Array<{ id: string; title: string; column: string; brandId?: string }> = []
const hookHandlers = new Map<string, (data: unknown) => unknown>()

beforeEach(async () => {
  rmSync(join(testDir, 'brands'), { recursive: true, force: true })
  tasks = []
  hookHandlers.clear()
  activated = await activatePlugin(brandsPlugin, testDir)
  for (const call of (activated.ctx.hooks.register as unknown as { mock: { calls: Array<[string, (data: unknown) => unknown]> } }).mock.calls) hookHandlers.set(call[0], call[1])
  ;(activated.ctx as unknown as { tasks: unknown }).tasks = { list: async (filter?: { brandId?: string }) => tasks.filter((t) => !filter?.brandId || t.brandId === filter.brandId), get: async (id: string) => tasks.find((t) => t.id === id) ?? null }
  ;(activated.ctx.assets as unknown as { getAsset: (id: string) => Promise<unknown> }).getAsset = async (id) => (existing.has(id) ? { assetId: id } : null)
  await callRoute(route('POST', '/'), activated.ctx, { body: { id: 'acme', name: 'Acme' } })
  await callRoute(route('PUT', '/:brandId'), activated.ctx, {
    searchParams: { brandId: 'acme' },
    body: { name: 'Acme', palette: [], logos: [{ assetId: 'gone', variant: 'dark' }, { assetId: 'kept', variant: 'light' }], assetGroups: [{ name: 'hero', assetIds: ['gone', 'kept', 'also-gone'] }], defaultImageReferences: ['also-gone'] },
  })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

async function rows() {
  const run = await checkBrandsIntegrity(activated.ctx)
  if (run.outcome !== 'observed') throw new Error('expected observed')
  return run.observations
}

describe('brand recover: detach dangling references', () => {
  it('the integrity incident is ONE per affected brand, on its recover page; required only while an open task uses the brand (row 189)', async () => {
    // Unused: advisory, nothing presumed.
    const unused = (await rows()).find((r) => r.key === 'integrity-acme')!
    expect(unused.incident).toMatchObject({ declarationId: 'integrity', required: false, disposition: 'advisory', subject: { kind: 'record', id: 'brands/acme', label: 'acme' }, resolution: { type: 'human', needs: 'decision', href: '/brands/acme?recover=1' } })
    expect(unused.evidence).toMatchObject({ openTasks: [], usageKnown: true })
    // Used by an open task: required. Done history does not count.
    tasks = [{ id: 't-open', title: 'Launch', column: 'todo', brandId: 'acme' }, { id: 't-done', title: 'Old', column: 'done', brandId: 'acme' }]
    const used = (await rows()).find((r) => r.key === 'integrity-acme')!
    expect(used.incident).toMatchObject({ required: true, disposition: 'action_required', resources: [{ kind: 'task', id: 't-open' }] })
    expect(used.evidence).toMatchObject({ openTasks: ['t-open'] })
  })
  it('two affected brands are two incidents, each on its own recover page', async () => {
    await callRoute(route('POST', '/'), activated.ctx, { body: { id: 'globex', name: 'Globex' } })
    await callRoute(route('PUT', '/:brandId'), activated.ctx, { searchParams: { brandId: 'globex' }, body: { name: 'Globex', palette: [], logos: [{ assetId: 'vanished', variant: 'dark' }], assetGroups: [], draft: false } })
    const incidents = (await rows()).filter((r) => r.incident).map((r) => [r.key, r.incident!.subject.id, (r.incident!.resolution as { href: string }).href])
    expect(incidents.sort()).toEqual([
      ['integrity-acme', 'brands/acme', '/brands/acme?recover=1'],
      ['integrity-globex', 'brands/globex', '/brands/globex?recover=1'],
    ])
  })
  it('an unreadable manifest is its own incident on the recover page (required while used); recreate salvages what still reads; the hooks answer references and detach', async () => {
    writeFileSync(join(testDir, 'brands', 'acme', 'brand.json'), '{ "id": "acme", "name": "Acme Corp", "description": "d", "palette": "nope" }')
    const invalid = (await rows()).find((r) => r.key === 'invalid-acme')!
    expect(invalid.incident).toMatchObject({ declarationId: 'integrity', required: false, disposition: 'advisory', subject: { kind: 'record', id: 'brands/acme' }, resolution: { href: '/brands/acme?recover=1' } })
    tasks = [{ id: 't-1', title: 'Launch', column: 'inProgress', brandId: 'acme' }]
    expect((await rows()).find((r) => r.key === 'invalid-acme')!.incident).toMatchObject({ required: true, disposition: 'action_required', resources: [{ kind: 'task', id: 't-1' }] })

    // The recover facts carry the raw bytes and the open tasks; recreate keeps id/name/description.
    const facts = await callRoute(route('GET', '/:brandId/recover'), activated.ctx, { searchParams: { brandId: 'acme' } })
    expect(facts.status).toBe(200)
    expect(facts.body).toMatchObject({ brandId: 'acme', status: 'invalid', raw: expect.stringContaining('"palette": "nope"'), tasks: [{ taskId: 't-1', title: 'Launch', column: 'inProgress' }], tasksKnown: true })
    const recreated = await callRoute(route('POST', '/:brandId/recover/recreate'), activated.ctx, { searchParams: { brandId: 'acme' } })
    expect(recreated.status).toBe(200)
    expect(recreated.body).toMatchObject({ ok: true, salvaged: ['name', 'description'], manifest: { id: 'acme', name: 'Acme Corp', description: 'd', palette: [], logos: [], assetGroups: [] } })
    expect((await rows()).some((r) => r.key === 'invalid-acme')).toBe(false)
    // Readable again: recreate is refused; an unknown brand 404s.
    expect((await callRoute(route('POST', '/:brandId/recover/recreate'), activated.ctx, { searchParams: { brandId: 'acme' } })).status).toBe(400)
    expect((await callRoute(route('POST', '/:brandId/recover/recreate'), activated.ctx, { searchParams: { brandId: 'nobody' } })).status).toBe(404)
    expect((await callRoute(route('GET', '/:brandId/recover'), activated.ctx, { searchParams: { brandId: 'nobody' } })).status).toBe(404)
  })
  it('ghost tasks: a task waiting on a MISSING brand lands on its brand field; one waiting on a DRAFT brand lands on the brand page', async () => {
    await callRoute(route('POST', '/'), activated.ctx, { body: { id: 'sketch', name: 'Sketch', draft: true } })
    tasks = [{ id: 't-missing', title: 'A', column: 'todo', brandId: 'nowhere' }, { id: 't-draft', title: 'B', column: 'todo', brandId: 'sketch' }]
    const all = await rows()
    expect(all.find((r) => r.key === 'ghost-nowhere')!.incident).toMatchObject({ required: true, disposition: 'action_required', subject: { kind: 'record', id: 'brands/nowhere' }, resources: [{ kind: 'task', id: 't-missing' }], resolution: { type: 'human', needs: 'decision', href: '/tasks?taskId=t-missing&field=brand' } })
    expect(all.find((r) => r.key === 'ghost-sketch')!.incident).toMatchObject({ required: true, resolution: { href: '/brands/sketch' } })
  })
  it('brands.assetReferences names every readable brand that references each asset; brands.detachAsset drops one asset from all of them', async () => {
    const references = hookHandlers.get('brands.assetReferences')!
    expect(await references({ assetIds: ['gone', 'kept', 'unknown'] })).toEqual({ byAsset: { gone: [{ brandId: 'acme', where: 'logo (dark)' }], kept: [{ brandId: 'acme', where: 'logo (light)' }] } })
    const detach = hookHandlers.get('brands.detachAsset')!
    expect(await detach({ assetId: 'kept' })).toEqual({ detached: ['acme'] })
    expect(await references({ assetIds: ['kept'] })).toEqual({ byAsset: {} })
    await expect(detach({})).rejects.toThrow(/assetId/)
  })
  it('POST /:brandId/recover/detach removes the named dangling ids everywhere they are referenced and keeps the live ones', async () => {
    const res = await callRoute(route('POST', '/:brandId/recover/detach'), activated.ctx, { searchParams: { brandId: 'acme' }, body: { assetIds: ['gone', 'also-gone'] } })
    expect(res.status).toBe(200)
    const body = res.body as unknown as { detached: string[]; brand: { logos: unknown[]; assetGroups: Array<{ assetIds: string[] }>; defaultImageReferences?: string[] } }
    expect(body.detached.sort()).toEqual(['also-gone', 'gone'])
    expect(body.brand.logos).toEqual([{ assetId: 'kept', variant: 'light' }])
    expect(body.brand.assetGroups[0]!.assetIds).toEqual(['kept'])
    expect(body.brand.defaultImageReferences ?? []).toEqual([])
    const after = await rows()
    expect(after.map((r) => r.status)).toEqual(['healthy'])
  })
  it('refuses to detach an id that still resolves to an asset, and 404s an unknown brand', async () => {
    const refused = await callRoute(route('POST', '/:brandId/recover/detach'), activated.ctx, { searchParams: { brandId: 'acme' }, body: { assetIds: ['kept'] } })
    expect(refused.status).toBe(400)
    const missing = await callRoute(route('POST', '/:brandId/recover/detach'), activated.ctx, { searchParams: { brandId: 'nobody' }, body: { assetIds: ['gone'] } })
    expect(missing.status).toBe(404)
  })
})
