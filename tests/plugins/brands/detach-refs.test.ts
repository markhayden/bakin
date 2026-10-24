/**
 * Brand recovery (self-healing PR1 slice 1.4a; re-homing row 189): the
 * operator detaches dangling asset references from a brand on
 * `/brands/<id>?recover=1`; the integrity incident points there when one
 * brand is affected.
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { rmSync } from 'fs'
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

beforeEach(async () => {
  rmSync(join(testDir, 'brands'), { recursive: true, force: true })
  activated = await activatePlugin(brandsPlugin, testDir)
  ;(activated.ctx.assets as unknown as { getAsset: (id: string) => Promise<unknown> }).getAsset = async (id) => (existing.has(id) ? { assetId: id } : null)
  await callRoute(route('POST', '/'), activated.ctx, { body: { id: 'acme', name: 'Acme' } })
  await callRoute(route('PUT', '/:brandId'), activated.ctx, {
    searchParams: { brandId: 'acme' },
    body: { name: 'Acme', palette: [], logos: [{ assetId: 'gone', variant: 'dark' }, { assetId: 'kept', variant: 'light' }], assetGroups: [{ name: 'hero', assetIds: ['gone', 'kept', 'also-gone'] }], defaultImageReferences: ['also-gone'] },
  })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('brand recover: detach dangling references', () => {
  it('the integrity incident points at the single affected brand\'s recover page', async () => {
    const run = await checkBrandsIntegrity(activated.ctx)
    if (run.outcome !== 'observed') throw new Error('expected observed')
    expect(run.observations[0]!.incident?.resolution).toMatchObject({ type: 'human', needs: 'decision', href: '/brands/acme?recover=1' })
    expect(run.observations[0]!.incident?.subject).toEqual({ kind: 'record', id: 'brands/acme', label: 'acme' })
  })
  it('POST /:brandId/recover/detach removes the named dangling ids everywhere they are referenced and keeps the live ones', async () => {
    const res = await callRoute(route('POST', '/:brandId/recover/detach'), activated.ctx, { searchParams: { brandId: 'acme' }, body: { assetIds: ['gone', 'also-gone'] } })
    expect(res.status).toBe(200)
    const body = res.body as unknown as { detached: string[]; brand: { logos: unknown[]; assetGroups: Array<{ assetIds: string[] }>; defaultImageReferences?: string[] } }
    expect(body.detached.sort()).toEqual(['also-gone', 'gone'])
    expect(body.brand.logos).toEqual([{ assetId: 'kept', variant: 'light' }])
    expect(body.brand.assetGroups[0]!.assetIds).toEqual(['kept'])
    expect(body.brand.defaultImageReferences ?? []).toEqual([])
    const after = await checkBrandsIntegrity(activated.ctx)
    if (after.outcome !== 'observed') throw new Error('expected observed')
    expect(after.observations[0]!.status).toBe('healthy')
  })
  it('refuses to detach an id that still resolves to an asset, and 404s an unknown brand', async () => {
    const refused = await callRoute(route('POST', '/:brandId/recover/detach'), activated.ctx, { searchParams: { brandId: 'acme' }, body: { assetIds: ['kept'] } })
    expect(refused.status).toBe(400)
    const missing = await callRoute(route('POST', '/:brandId/recover/detach'), activated.ctx, { searchParams: { brandId: 'nobody' }, body: { assetIds: ['gone'] } })
    expect(missing.status).toBe(404)
  })
})
