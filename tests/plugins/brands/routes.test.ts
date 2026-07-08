/**
 * Brands plugin REST surface + hooks (#419, spec §7).
 *
 * CRUD on brands (create scaffolds starter guidelines), guideline/lesson doc
 * CRUD, and the brands.get / brands.list hooks (drafts excluded from list).
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-brand-routes-${Date.now()}-${randomUUID()}`)
const paths = () => ({
  home: testDir,
  brands: join(testDir, 'brands'),
  db: join(testDir, 'bakin.db'),
})

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: paths,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: paths,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import brandsPlugin from '../../../plugins/brands'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'

let activated: ActivatedPlugin

beforeEach(async () => {
  rmSync(join(testDir, 'brands'), { recursive: true, force: true })
  activated = await activatePlugin(brandsPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

const route = (method: string, path: string) => {
  const r = findRoute(activated.routes, method, path)
  if (!r) throw new Error(`route not found: ${method} ${path}`)
  return r
}

async function createAcme(extra: Record<string, unknown> = {}) {
  return callRoute(route('POST', '/'), activated.ctx, {
    body: { id: 'acme', name: 'Acme', ...extra },
  })
}

describe('brand CRUD routes', () => {
  it('creates a brand with scaffolded guidelines and lists it', async () => {
    const created = await createAcme()
    expect(created.status).toBe(200)
    expect((created.body.brand as { id: string }).id).toBe('acme')

    const detail = await callRoute(route('GET', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
    })
    expect(detail.status).toBe(200)
    const guidelines = detail.body.guidelines as Array<{ name: string }>
    expect(guidelines.map((g) => g.name)).toContain('voice.md')
    expect(guidelines.map((g) => g.name)).toContain('style-guide.md')
    expect(detail.body.fingerprint).toMatch(/^sha256:/)

    const list = await callRoute(route('GET', '/'), activated.ctx)
    expect((list.body.brands as Array<{ id: string }>).map((b) => b.id)).toEqual(['acme'])
  })

  it('rejects duplicates (409) and invalid slugs (400)', async () => {
    await createAcme()
    expect((await createAcme()).status).toBe(409)
    const bad = await callRoute(route('POST', '/'), activated.ctx, {
      body: { id: 'Not A Slug', name: 'x' },
    })
    expect(bad.status).toBe(400)
  })

  it('404s on a missing brand and deletes an existing one', async () => {
    const missing = await callRoute(route('GET', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'ghost' },
    })
    expect(missing.status).toBe(404)

    await createAcme()
    const del = await callRoute(route('DELETE', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
    })
    expect(del.status).toBe(200)
    const after = await callRoute(route('GET', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
    })
    expect(after.status).toBe(404)
  })

  it('replaces the manifest via PUT, preserving identity', async () => {
    await createAcme()
    const put = await callRoute(route('PUT', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
      body: {
        name: 'Acme Inc',
        palette: [{ name: 'ink', hex: '#1A1A2E' }],
        rules: ['Never use emojis'],
        logos: [],
        assetGroups: [],
      },
    })
    expect(put.status).toBe(200)
    expect((put.body.brand as { name: string }).name).toBe('Acme Inc')
    expect((put.body.brand as { rules: string[] }).rules).toEqual(['Never use emojis'])

    const badHex = await callRoute(route('PUT', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
      body: { name: 'x', palette: [{ name: 'ink', hex: 'blueish' }], logos: [], assetGroups: [] },
    })
    expect(badHex.status).toBe(400)
  })
})

describe('brand doc routes', () => {
  it('writes, reads, deletes docs; rejects bad kinds', async () => {
    await createAcme()
    const put = await callRoute(route('PUT', '/:brandId/docs/:kind/:name'), activated.ctx, {
      searchParams: { brandId: 'acme', kind: 'lessons', name: 'tweet-flop.md' },
      body: { content: '# Never again\n' },
    })
    expect(put.status).toBe(200)

    const get = await callRoute(route('GET', '/:brandId/docs/:kind/:name'), activated.ctx, {
      searchParams: { brandId: 'acme', kind: 'lessons', name: 'tweet-flop.md' },
    })
    expect(get.status).toBe(200)
    expect(get.body.content).toContain('# Never again')

    const badKind = await callRoute(route('GET', '/:brandId/docs/:kind/:name'), activated.ctx, {
      searchParams: { brandId: 'acme', kind: 'secrets', name: 'x.md' },
    })
    expect(badKind.status).toBe(400)

    const del = await callRoute(route('DELETE', '/:brandId/docs/:kind/:name'), activated.ctx, {
      searchParams: { brandId: 'acme', kind: 'lessons', name: 'tweet-flop.md' },
    })
    expect(del.status).toBe(200)
    const gone = await callRoute(route('GET', '/:brandId/docs/:kind/:name'), activated.ctx, {
      searchParams: { brandId: 'acme', kind: 'lessons', name: 'tweet-flop.md' },
    })
    expect(gone.status).toBe(404)
  })
})

describe('hooks', () => {
  function hookHandler(name: string): (data: unknown) => unknown {
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: unknown) => unknown]> }
    }
    const call = registerMock.mock.calls.find((c) => c[0] === name)
    if (!call) throw new Error(`hook not registered: ${name}`)
    return call[1]
  }

  it('registers brands.get returning manifest + docs + fingerprint', async () => {
    await createAcme()
    const get = hookHandler('brands.get')
    const result = (await get({ brandId: 'acme' })) as {
      manifest: { id: string }
      guidelines: Array<{ name: string }>
      fingerprint: string
    }
    expect(result.manifest.id).toBe('acme')
    expect(result.guidelines.map((g) => g.name)).toContain('voice.md')
    expect(result.fingerprint).toMatch(/^sha256:/)
    expect(await get({ brandId: 'ghost' })).toBeUndefined()
  })

  it('registers brands.list excluding drafts', async () => {
    await createAcme()
    await callRoute(route('POST', '/'), activated.ctx, {
      body: { id: 'wip', name: 'WIP', draft: true },
    })
    const list = hookHandler('brands.list')
    const result = (await list({})) as { brands: Array<{ id: string }> }
    expect(result.brands.map((b) => b.id)).toEqual(['acme'])
  })
})
