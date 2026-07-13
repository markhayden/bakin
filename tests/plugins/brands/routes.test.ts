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

  it('carries completeness on both list (summary) and detail (full checklist)', async () => {
    await createAcme()
    const list = await callRoute(route('GET', '/'), activated.ctx)
    const listed = (list.body.brands as Array<{ completeness: { percent: number; missing: string[] } }>)[0]
    expect(typeof listed.completeness.percent).toBe('number')
    // fresh scaffold-only brand: docs are unauthored, palette empty, no logo
    expect(listed.completeness.missing).toContain('logo')
    expect(listed.completeness.missing).toContain('voice')

    const detail = await callRoute(route('GET', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
    })
    const full = detail.body.completeness as { percent: number; items: Array<{ key: string; done: boolean; fixTab: string }> }
    expect(full.items).toHaveLength(8)
    expect(full.items.every((i) => typeof i.done === 'boolean' && i.fixTab.length > 0)).toBe(true)
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
  it('classifies the blocked-task badge poll as routine activity', () => {
    expect(route('GET', '/blocked-tasks').activityClass).toBe('routine')
  })

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

  it('website mode: url-only payload works and the task prompt mines the sources', async () => {
    const created = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: { id: 'from-web', name: 'From Web', agent: 'pixel', urls: 'https://acme.example https://acme.example/styleguide' },
    })
    expect(created.status).toBe(200)
    expect((created.body.brand as { draft?: boolean }).draft).toBe(true)
    expect(created.body.taskId).toBeTruthy() // drafting banner links this

    const task = await activated.ctx.tasks.get(String(created.body.taskId))
    expect(task?.description).toContain('Fetch and READ each source URL')
    expect(task?.description).toContain('https://acme.example/styleguide')
    expect(task?.description).toContain('Source findings')

    const intake = await callRoute(route('GET', '/:brandId/docs/:kind/:name'), activated.ctx, {
      searchParams: { brandId: 'from-web', kind: 'guidelines', name: '_intake.md' },
    })
    expect(String(intake.body.content)).toContain('Source URLs to mine')
  })

  it('rejects a builder payload with neither product nor urls', async () => {
    const bad = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: { id: 'nothing', name: 'Nothing', agent: 'pixel' },
    })
    expect(bad.status).toBe(400)
  })

  it('questionnaire mode without urls has no mining step', async () => {
    const created = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: { id: 'no-urls', name: 'No Urls', agent: 'pixel', product: 'Widgets' },
    })
    const task = await activated.ctx.tasks.get(String(created.body.taskId))
    expect(task?.description).not.toContain('Fetch and READ')
  })

  it('a manifest PUT can NEVER flip publication state (draft/draftTaskId are server-owned)', async () => {
    // published brand + a stale staged body claiming draft:true → stays published
    await createAcme()
    const put = await callRoute(route('PUT', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
      body: { name: 'Acme', palette: [], logos: [], assetGroups: [], draft: true, draftTaskId: 'ghost-task' },
    })
    expect(put.status).toBe(200)
    expect((put.body.brand as { draft?: boolean }).draft).toBeUndefined()
    expect((put.body.brand as { draftTaskId?: string }).draftTaskId).toBeUndefined()

    // draft brand + a body omitting draft → stays a draft
    const built = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: { id: 'still-draft', name: 'Still Draft', agent: 'pixel', product: 'x' },
    })
    const putDraft = await callRoute(route('PUT', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'still-draft' },
      body: { name: 'Still Draft', palette: [], logos: [], assetGroups: [] },
    })
    expect((putDraft.body.brand as { draft?: boolean }).draft).toBe(true)
    expect((putDraft.body.brand as { draftTaskId?: string }).draftTaskId).toBe(String(built.body.taskId))
  })

  it('unpublish flips a published brand back to draft; 400 when already a draft', async () => {
    await createAcme()
    const un = await callRoute(route('POST', '/:brandId/unpublish'), activated.ctx, {
      searchParams: { brandId: 'acme' },
    })
    expect(un.status).toBe(200)
    expect((un.body.brand as { draft?: boolean }).draft).toBe(true)

    const again = await callRoute(route('POST', '/:brandId/unpublish'), activated.ctx, {
      searchParams: { brandId: 'acme' },
    })
    expect(again.status).toBe(400)

    // publish brings it back
    const pub = await callRoute(route('POST', '/:brandId/publish'), activated.ctx, {
      searchParams: { brandId: 'acme' },
    })
    expect((pub.body.brand as { draft?: boolean }).draft).toBeUndefined()
  })

  it('stamps draftTaskId on the manifest; publish clears it', async () => {
    const created = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: { id: 'stamped', name: 'Stamped', agent: 'pixel', product: 'x' },
    })
    expect((created.body.brand as { draftTaskId?: string }).draftTaskId).toBe(String(created.body.taskId))

    const published = await callRoute(route('POST', '/:brandId/publish'), activated.ctx, {
      searchParams: { brandId: 'stamped' },
    })
    expect((published.body.brand as { draftTaskId?: string }).draftTaskId).toBeUndefined()
  })

  it('intake materials attach as an asset group and the prompt tells the agent to mine them', async () => {
    const created = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: {
        id: 'material-brand',
        name: 'Material Brand',
        agent: 'pixel',
        product: 'x',
        materialAssetIds: ['20260101-deck-aaaa1111', '20260101-shot-bbbb2222'],
      },
    })
    expect(created.status).toBe(200)
    const groups = (created.body.brand as { assetGroups: Array<{ name: string; assetIds: string[] }> }).assetGroups
    const intake = groups.find((g) => g.name === 'intake-materials')
    expect(intake?.assetIds).toEqual(['20260101-deck-aaaa1111', '20260101-shot-bbbb2222'])

    const task = await activated.ctx.tasks.get(String(created.body.taskId))
    expect(task?.description).toContain('intake-materials')
    expect(task?.description).toContain('palette hex values')
  })

  it('rejects more than 3 intake materials', async () => {
    const bad = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: { id: 'too-many', name: 'x', agent: 'pixel', product: 'x', materialAssetIds: ['a', 'b', 'c', 'd'] },
    })
    expect(bad.status).toBe(400)
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

  it('rolls back the draft when a downstream step fails, so retries are not 409-blocked', async () => {
    const realCreate = activated.ctx.tasks.create
    // Simulate ctx.tasks.create rejecting (bad agent, dispatch error, etc.).
    activated.ctx.tasks.create = (() => Promise.reject(new Error('boom'))) as typeof realCreate
    const failed = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: { id: 'rollback-brand', name: 'Rollback', agent: 'pixel', product: 'x' },
    })
    expect(failed.status).toBe(500)

    // No orphaned draft left behind.
    const gone = await callRoute(route('GET', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'rollback-brand' },
    })
    expect(gone.status).toBe(404)

    // Retry with the same id now succeeds instead of tripping 'exists' → 409.
    activated.ctx.tasks.create = realCreate
    const retry = await callRoute(route('POST', '/builder'), activated.ctx, {
      body: { id: 'rollback-brand', name: 'Rollback', agent: 'pixel', product: 'x' },
    })
    expect(retry.status).toBe(200)
    expect((retry.body.brand as { draft?: boolean }).draft).toBe(true)
  })
})

describe('doc brainstorm (embedded editing help)', () => {
  it('streams a turn as SSE frames with the live doc content in the prompt', async () => {
    await createAcme()
    let seenArgs: Record<string, unknown> = {}
    const runtime = activated.ctx.runtime as unknown as {
      messaging: { stream: (args: Record<string, unknown>) => AsyncIterable<Record<string, unknown>> }
    }
    runtime.messaging = {
      ...(runtime.messaging ?? {}),
      stream: (args: Record<string, unknown>) => {
        seenArgs = args
        return (async function* () {
          yield { type: 'text', content: 'Tighten ' }
          yield { type: 'text', content: 'the intro.' }
        })()
      },
    } as typeof runtime.messaging

    const res = await callRoute(route('POST', '/:brandId/docs/:kind/:name/brainstorm'), activated.ctx, {
      searchParams: { brandId: 'acme', kind: 'guidelines', name: 'voice.md' },
      body: {
        agent: 'pixel',
        message: 'What is missing?',
        history: [{ role: 'user', content: 'earlier question' }],
        docContent: '# Voice\n\nUNSAVED DRAFT CONTENT',
      },
      rawResponse: true,
    })
    expect(res.status).toBe(200)
    expect(res.response.headers.get('Content-Type')).toBe('text/event-stream')
    const text = await res.response.text()
    expect(text).toContain('event: chunk')
    expect(text).toContain('Tighten ')
    expect(text).toContain('event: done')
    expect(text).toContain('"content":"Tighten the intro."')

    // the prompt carries the EDITOR's live content + history, and the turn is ephemeral
    expect(String(seenArgs.content)).toContain('UNSAVED DRAFT CONTENT')
    expect(String(seenArgs.content)).toContain('earlier question')
    expect(String(seenArgs.content)).toContain('do NOT write files')
    expect(seenArgs.ephemeral).toBe(true)
    expect(seenArgs.agentId).toBe('pixel')
    expect(String(seenArgs.threadId)).toContain('brand-doc')
  })

  it('uses a fresh per-turn threadId and caps history in the prompt (no quadratic session pileup)', async () => {
    await createAcme()
    const seenThreads: string[] = []
    let seenPrompt = ''
    const runtime = activated.ctx.runtime as unknown as {
      messaging: { stream: (args: Record<string, unknown>) => AsyncIterable<Record<string, unknown>> }
    }
    runtime.messaging = {
      ...(runtime.messaging ?? {}),
      stream: (args: Record<string, unknown>) => {
        seenThreads.push(String(args.threadId))
        seenPrompt = String(args.content)
        return (async function* () {
          yield { type: 'text', content: 'ok' }
        })()
      },
    } as typeof runtime.messaging

    const history = Array.from({ length: 12 }, (_, i) => ({ role: 'user' as const, content: `exchange-${i}` }))
    const call = () =>
      callRoute(route('POST', '/:brandId/docs/:kind/:name/brainstorm'), activated.ctx, {
        searchParams: { brandId: 'acme', kind: 'guidelines', name: 'voice.md' },
        body: { agent: 'pixel', message: 'hi', history },
        rawResponse: true,
      })
    await (await call()).response.text()
    await (await call()).response.text()

    expect(seenThreads[0]).not.toBe(seenThreads[1]) // per-turn thread
    expect(seenPrompt).toContain('exchange-11') // newest kept
    expect(seenPrompt).not.toContain('exchange-0') // oldest capped away (last 8 only)
  })

  it('cancelling the brainstorm response stream aborts the runtime turn', async () => {
    await createAcme()
    let sawAbort = false
    const runtime = activated.ctx.runtime as unknown as {
      messaging: { stream: (args: Record<string, unknown>) => AsyncIterable<Record<string, unknown>> }
    }
    runtime.messaging = {
      ...(runtime.messaging ?? {}),
      stream: (args: Record<string, unknown>) => {
        const signal = args.signal as AbortSignal
        return (async function* () {
          yield { type: 'text', content: 'first' }
          // hold the turn open until the signal fires or 2s passes
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve()
            const t = setTimeout(resolve, 2000)
            signal.addEventListener('abort', () => { clearTimeout(t); sawAbort = true; resolve() }, { once: true })
          })
          if (!signal.aborted) yield { type: 'text', content: 'second' }
        })()
      },
    } as typeof runtime.messaging

    const res = await callRoute(route('POST', '/:brandId/docs/:kind/:name/brainstorm'), activated.ctx, {
      searchParams: { brandId: 'acme', kind: 'guidelines', name: 'voice.md' },
      body: { agent: 'pixel', message: 'hi' },
      rawResponse: true,
    })
    const reader = res.response.body!.getReader()
    await reader.read() // first chunk arrives
    await reader.cancel() // consumer walks away
    await new Promise((r) => setTimeout(r, 50))
    expect(sawAbort).toBe(true)
  })

  it('streams an error frame when the runtime turn fails (never a hung stream)', async () => {
    await createAcme()
    const runtime = activated.ctx.runtime as unknown as {
      messaging: { stream: (args: Record<string, unknown>) => AsyncIterable<Record<string, unknown>> }
    }
    runtime.messaging = {
      ...(runtime.messaging ?? {}),
      // eslint-disable-next-line require-yield
      stream: () => (async function* (): AsyncGenerator<Record<string, unknown>> {
        throw new Error('runtime down')
      })(),
    } as typeof runtime.messaging

    const res = await callRoute(route('POST', '/:brandId/docs/:kind/:name/brainstorm'), activated.ctx, {
      searchParams: { brandId: 'acme', kind: 'guidelines', name: 'voice.md' },
      body: { agent: 'pixel', message: 'hi' },
      rawResponse: true,
    })
    const text = await res.response.text()
    expect(text).toContain('event: error')
    expect(text).toContain('runtime down')
  })

  it('404s for a ghost brand', async () => {
    const res = await callRoute(route('POST', '/:brandId/docs/:kind/:name/brainstorm'), activated.ctx, {
      searchParams: { brandId: 'ghost', kind: 'guidelines', name: 'voice.md' },
      body: { agent: 'pixel', message: 'hi' },
    })
    expect(res.status).toBe(404)
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

  it('a busy neighbour brand cannot push this brand out of the window', async () => {
    const { writeFileSync } = await import('fs')
    const older = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago, still in 30d window
    const now = new Date().toISOString()
    // acme's real events land FIRST in the file (oldest), then a flood of newer
    // neighbour events. A fleet-wide cap + post-filter would read only the newest
    // rows (all neighbour) and drop acme entirely; the per-brand match must not.
    const acmeLines = [
      { ts: older, event: 'brand.created', agent: 'system', data: { brandId: 'acme' } },
      { ts: older, event: 'brand.injected', agent: 'jessica', data: { brandId: 'acme', taskId: 't1' } },
    ]
    const neighbourLines = Array.from({ length: 1200 }, (_, i) => ({
      ts: now, event: 'brand.injected', agent: 'noisy', data: { brandId: 'other', taskId: `n${i}` },
    }))
    const lines = [...acmeLines, ...neighbourLines].map((l) => JSON.stringify(l)).join('\n')
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
    expect(clean.outcome).toBe('observed')
    if (clean.outcome !== 'observed') throw new Error('expected observed brand health')
    expect(clean.observations[0].status).toBe('healthy')

    // Break it: dangling logo ref + a todo task pointing at a ghost brand
    await callRoute(route('PUT', '/:brandId'), activated.ctx, {
      searchParams: { brandId: 'acme' },
      body: { name: 'Acme', palette: [], logos: [{ assetId: 'gone', variant: 'dark' }], assetGroups: [] },
    })
    assetsMock.getAsset = async () => null
    await activated.ctx.tasks.create({ title: 'Stuck', brandId: 'ghost', column: 'todo' } as never)

    const broken = await checkBrandsIntegrity(activated.ctx)
    expect(broken.outcome).toBe('observed')
    if (broken.outcome !== 'observed') throw new Error('expected observed brand health')
    expect(broken.observations[0].status).toBe('warning')
    const data = broken.observations[0].evidence as { dangling: Array<{ brandId: string }>; ghostTasks: Array<{ brandId: string }> }
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
