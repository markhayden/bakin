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
import { activatePlugin, callRoute, callTool, findRoute, type ActivatedPlugin } from '../test-helpers'

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

  it('registers brands.getContext — card for published, notFound for missing/draft', async () => {
    await createAcme()
    await callRoute(route('POST', '/'), activated.ctx, {
      body: { id: 'wip', name: 'WIP', draft: true },
    })
    const getContext = hookHandler('brands.getContext')

    const ok = (await getContext({ brandId: 'acme', maxBytes: 12288 })) as {
      card: string
      meta: { brandId: string; cardBytes: number }
    }
    expect(ok.card).toContain('Brand: Acme (acme)')
    expect(ok.meta.brandId).toBe('acme')

    expect(await getContext({ brandId: 'ghost' })).toEqual({ notFound: true })
    expect(await getContext({ brandId: 'wip' })).toEqual({ notFound: true })
  })
})

describe('observability routes (#419 §5.5)', () => {
  it('task-context resolves effective brand with provenance + blocked state', async () => {
    await createAcme()
    const t1 = await activated.ctx.tasks.create({ title: 'Branded', brandId: 'acme' } as never)
    const ctx1 = await callRoute(route('GET', '/task-context/:taskId'), activated.ctx, {
      searchParams: { taskId: t1.id },
    })
    expect(ctx1.status).toBe(200)
    const brand1 = ctx1.body.brand as { brandId: string; source: string; blocked: boolean }
    expect(brand1.brandId).toBe('acme')
    expect(brand1.source).toBe('own')
    expect(brand1.blocked).toBe(false)

    const ghost = await activated.ctx.tasks.create({ title: 'Ghost brand', brandId: 'ghost' } as never)
    const ctx2 = await callRoute(route('GET', '/task-context/:taskId'), activated.ctx, {
      searchParams: { taskId: ghost.id },
    })
    expect((ctx2.body.brand as { blocked: boolean }).blocked).toBe(true)

    const plain = await activated.ctx.tasks.create({ title: 'Plain' } as never)
    const ctx3 = await callRoute(route('GET', '/task-context/:taskId'), activated.ctx, {
      searchParams: { taskId: plain.id },
    })
    expect(ctx3.body.brand).toBeNull()
  })

  it('blocked-tasks reports todo tasks deferring on missing/draft brands', async () => {
    await createAcme()
    const ok = await activated.ctx.tasks.create({ title: 'Fine', brandId: 'acme', column: 'todo' } as never)
    const stuck = await activated.ctx.tasks.create({ title: 'Stuck', brandId: 'ghost', column: 'todo' } as never)
    const res = await callRoute(route('GET', '/blocked-tasks'), activated.ctx)
    expect(res.status).toBe(200)
    const perTask = res.body.perTask as Record<string, string>
    expect(perTask[stuck.id]).toBe('ghost')
    expect(perTask[ok.id]).toBeUndefined()
  })

  it('injections returns bounded, task-filtered brand.injected records', async () => {
    const { writeFileSync } = await import('fs')
    const now = new Date().toISOString()
    const lines = [
      { ts: now, event: 'brand.injected', agent: 'jessica', data: { taskId: 't-a', runId: 'r1', brandId: 'acme', cardBytes: 900 } },
      { ts: now, event: 'brand.injected', agent: 'jessica', data: { taskId: 't-b', runId: 'r2', brandId: 'acme', cardBytes: 800 } },
      { ts: now, event: 'task.dispatched', agent: 'jessica', data: { taskId: 't-a' } },
    ].map((l) => JSON.stringify(l)).join('\n')
    writeFileSync(join(testDir, 'audit.jsonl'), lines + '\n', 'utf-8')

    const res = await callRoute(route('GET', '/injections/:taskId'), activated.ctx, {
      searchParams: { taskId: 't-a' },
    })
    expect(res.status).toBe(200)
    const injections = res.body.injections as Array<{ runId: string; cardBytes: number }>
    expect(injections.map((i) => i.runId)).toEqual(['r1'])
    expect(injections[0].cardBytes).toBe(900)
  })

  it('card-preview renders the same card the dispatch builder produces', async () => {
    await createAcme()
    const res = await callRoute(route('GET', '/:brandId/card-preview'), activated.ctx, {
      searchParams: { brandId: 'acme' },
    })
    expect(res.status).toBe(200)
    expect(String(res.body.card)).toContain('Brand: Acme (acme)')
    expect((res.body.meta as { cardBytes: number }).cardBytes).toBeGreaterThan(0)
    expect(res.body.maxBytes).toBe(12288)

    const missing = await callRoute(route('GET', '/:brandId/card-preview'), activated.ctx, {
      searchParams: { brandId: 'ghost' },
    })
    expect(missing.status).toBe(404)
  })
})

describe('builder flow (#419 §9.1)', () => {
  it('creates a draft + intake + drafting task; publish flips it live', async () => {
    const created = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: {
        id: 'loaf-ladle',
        name: 'Loaf & Ladle',
        agent: 'pixel',
        product: 'Sourdough bakery software',
        tone: 'warm, direct, floury',
      },
    })
    expect(created.status).toBe(200)
    expect((created.body.brand as { draft?: boolean }).draft).toBe(true)
    expect(created.body.taskId).toBeTruthy()

    // Intake written; drafting task deliberately UNBRANDED (a draft would
    // trip the dispatch brand gate)
    const intake = await callRoute(route('GET', '/:brandId/docs/:kind/:name'), activated.ctx, {
      searchParams: { brandId: 'loaf-ladle', kind: 'guidelines', name: '_intake.md' },
    })
    expect(String(intake.body.content)).toContain('Sourdough bakery software')
    const task = await activated.ctx.tasks.get(String(created.body.taskId))
    expect(task?.brandId).toBeUndefined()
    expect(task?.agent).toBe('pixel')

    // Draft excluded from list hook / getContext (checked in hooks tests);
    // publish flips it live + audits
    const published = await callRoute(route('POST', '/:brandId/publish'), activated.ctx, {
      searchParams: { brandId: 'loaf-ladle' },
    })
    expect(published.status).toBe(200)
    expect((published.body.brand as { draft?: boolean }).draft).toBeUndefined()

    const again = await callRoute(route('POST', '/:brandId/publish'), activated.ctx, {
      searchParams: { brandId: 'loaf-ladle' },
    })
    expect(again.status).toBe(400) // already published
  })

  it('builder wires an uploaded logo onto the draft (#419 wizard)', async () => {
    const created = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: { id: 'logo-brand', name: 'Logo Brand', agent: 'pixel', product: 'x', logoAssetId: '20260101-logo-abcd1234' },
    })
    expect(created.status).toBe(200)
    expect((created.body.brand as { logos: Array<{ assetId: string; variant: string }> }).logos).toEqual([
      { assetId: '20260101-logo-abcd1234', variant: 'primary' },
    ])
  })
})

describe('activity feed (#419 Overview)', () => {
  it('returns brand-scoped brand.* audit events, newest first', async () => {
    const { writeFileSync } = await import('fs')
    const now = new Date().toISOString()
    const lines = [
      { ts: now, event: 'brand.created', agent: 'system', data: { brandId: 'acme' } },
      { ts: now, event: 'brand.injected', agent: 'jessica', data: { brandId: 'acme', taskId: 't1' } },
      { ts: now, event: 'brand.updated', agent: 'system', data: { brandId: 'other' } }, // wrong brand
      { ts: now, event: 'task.dispatched', agent: 'x', data: { brandId: 'acme' } },      // not a brand.* kind
    ].map((l) => JSON.stringify(l)).join('\n')
    writeFileSync(join(testDir, 'audit.jsonl'), lines + '\n', 'utf-8')

    const res = await callRoute(route('GET', '/:brandId/activity'), activated.ctx, { searchParams: { brandId: 'acme' } })
    expect(res.status).toBe(200)
    const activity = res.body.activity as Array<{ event: string }>
    expect(activity.map((a) => a.event)).toEqual(['brand.injected', 'brand.created'])
  })

  it('write tools are draft-gated: work on drafts, typed error on published brands', async () => {
    await callRoute(route('POST', '/'), activated.ctx, { body: { id: 'wip', name: 'WIP', draft: true } })
    await createAcme() // published

    const tool = (name: string) => {
      const t = activated.execTools.find((t) => t.name === name)
      if (!t) throw new Error(`tool not registered: ${name}`)
      return t
    }

    const draftWrite = await callTool(tool('bakin_exec_brands_write_doc'), {
      brandId: 'wip', kind: 'guidelines', name: 'voice.md', content: 'Drafted voice.',
    })
    expect(draftWrite.ok).toBe(true)

    const draftManifest = await callTool(tool('bakin_exec_brands_update_manifest'), {
      brandId: 'wip',
      palette: [{ name: 'ink', hex: '#101020' }],
      rules: ['Never shout'],
    })
    expect(draftManifest.ok).toBe(true)
    expect((draftManifest.brand as { rules: string[] }).rules).toEqual(['Never shout'])

    const publishedWrite = await callTool(tool('bakin_exec_brands_write_doc'), {
      brandId: 'acme', kind: 'guidelines', name: 'voice.md', content: 'hijack',
    })
    expect(publishedWrite.ok).toBe(false)
    expect(String(publishedWrite.error)).toContain('PUBLISHED')

    const publishedManifest = await callTool(tool('bakin_exec_brands_update_manifest'), {
      brandId: 'acme', rules: ['hijack'],
    })
    expect(publishedManifest.ok).toBe(false)
  })
})

describe('brands.integrity doctor check (#419 §10)', () => {
  it('warns with structured data on dangling refs + ghost-brand tasks; ok when clean', async () => {
    const { checkBrandsIntegrity } = await import('../../../plugins/brands/lib/health-checks')

    // Clean state: one healthy brand, no ghost tasks
    await createAcme()
    const assetsMock = activated.ctx.assets as unknown as { getAsset: (id: string) => Promise<unknown> }
    assetsMock.getAsset = async () => ({ assetId: 'x' })
    const clean = await checkBrandsIntegrity(activated.ctx)
    expect(clean.status).toBe('ok')

    // Break it: dangling logo ref + a todo task pointing at a ghost brand
    await callRoute(route('PUT', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
      body: { name: 'Acme', palette: [], logos: [{ assetId: 'gone', variant: 'dark' }], assetGroups: [] },
    })
    assetsMock.getAsset = async () => null
    await activated.ctx.tasks.create({ title: 'Stuck', brandId: 'ghost', column: 'todo' } as never)

    const broken = await checkBrandsIntegrity(activated.ctx)
    expect(broken.status).toBe('warn')
    const data = broken.data as { dangling: Array<{ brandId: string }>; ghostTasks: Array<{ brandId: string }> }
    expect(data.dangling[0].brandId).toBe('acme')
    expect(data.ghostTasks[0].brandId).toBe('ghost')
  })
})

describe('exec tools', () => {
  function tool(name: string) {
    const t = activated.execTools.find((t) => t.name === name)
    if (!t) throw new Error(`tool not registered: ${name}`)
    return t
  }

  it('list/get/read_doc round-trip; drafts excluded from list', async () => {
    await createAcme()
    await callRoute(route('POST', '/'), activated.ctx, {
      body: { id: 'wip', name: 'WIP', draft: true },
    })

    const listed = await callTool(tool('bakin_exec_brands_list'), {})
    expect((listed.brands as Array<{ id: string }>).map((b) => b.id)).toEqual(['acme'])

    const got = await callTool(tool('bakin_exec_brands_get'), { brandId: 'acme' })
    expect(got.ok).toBe(true)
    expect((got.brand as { name: string }).name).toBe('Acme')
    expect((got.guidelines as Array<{ name: string }>).map((g) => g.name)).toContain('voice.md')

    const doc = await callTool(tool('bakin_exec_brands_read_doc'), {
      brandId: 'acme',
      kind: 'guidelines',
      name: 'voice.md',
    })
    expect(doc.ok).toBe(true)
    expect(String(doc.content)).toContain('Voice')

    const bad = await callTool(tool('bakin_exec_brands_get'), { brandId: 'ghost' })
    expect(bad.ok).toBe(false)
  })

  it('get joins asset captions via assets.describe (S7)', async () => {
    await createAcme()
    const put = await callRoute(route('PUT', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
      body: {
        name: 'Acme',
        palette: [],
        logos: [],
        assetGroups: [{ name: 'shots', assetIds: ['asset-billing'] }],
      },
    })
    expect(put.status).toBe(200)

    // Wire assets.describe onto the mocked hooks surface
    const hooksMock = activated.ctx.hooks as unknown as { has: (n: string) => boolean; invoke: (n: string, d: unknown) => unknown }
    hooksMock.has = (n: string) => n === 'assets.describe'
    hooksMock.invoke = async (n: string) =>
      n === 'assets.describe'
        ? { 'asset-billing': { description: 'Billing page', caption: 'The billing settings screen', type: 'images', exists: true } }
        : undefined

    const got = await callTool(tool('bakin_exec_brands_get'), { brandId: 'acme' })
    expect(got.ok).toBe(true)
    const details = got.assetDetails as Record<string, { caption?: string }>
    expect(details['asset-billing']?.caption).toBe('The billing settings screen')
  })

  it('integrity route reports dangling refs via the shared scan', async () => {
    await createAcme()
    await callRoute(route('PUT', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
      body: {
        name: 'Acme',
        palette: [],
        logos: [{ assetId: 'ghost-logo', variant: 'dark' }],
        assetGroups: [],
      },
    })
    // ctx.assets.getAsset mock: nothing exists
    const assetsMock = activated.ctx.assets as unknown as { getAsset: (id: string) => Promise<null> }
    assetsMock.getAsset = async () => null

    const res = await callRoute(route('GET', '/:brandId/integrity'), activated.ctx, {
      searchParams: { brandId: 'acme' },
    })
    expect(res.status).toBe(200)
    const findings = res.body.findings as Array<{ brandId: string; dangling: Array<{ assetId: string }> }>
    expect(findings[0].dangling.map((d) => d.assetId)).toEqual(['ghost-logo'])
  })

  it('add_lesson is append-only and never overwrites (#419 §6)', async () => {
    await createAcme()
    const first = await callTool(tool('bakin_exec_brands_add_lesson'), {
      brandId: 'acme',
      title: 'Never use threads',
      body: 'Single posts only on LinkedIn.',
    })
    expect(first.ok).toBe(true)
    expect(first.lesson).toBe('never-use-threads.md')

    const doc = await callTool(tool('bakin_exec_brands_read_doc'), {
      brandId: 'acme', kind: 'lessons', name: 'never-use-threads.md',
    })
    expect(String(doc.content)).toContain('Single posts only')

    // Same title again → new file, original untouched
    const second = await callTool(tool('bakin_exec_brands_add_lesson'), {
      brandId: 'acme',
      title: 'Never use threads',
      body: 'A different learning.',
    })
    expect(second.ok).toBe(true)
    expect(second.lesson).not.toBe('never-use-threads.md')

    const ghost = await callTool(tool('bakin_exec_brands_add_lesson'), {
      brandId: 'ghost', title: 'x', body: 'y',
    })
    expect(ghost.ok).toBe(false)
  })
})
