/** The updates HTTP surface: list, check now (async + wait), skip; 503 before the engine starts (#1007 D7.5/D7.8). */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-routes-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
process.env.BAKIN_HOME = testDir
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../src/core/sse', () => ({ broadcast: (data: Record<string, unknown>) => { broadcasts.push(data) } }))
afterAll(() => { delete process.env.BAKIN_HOME; rmSync(testDir, { recursive: true, force: true }) })

import * as updatesRoute from '../../packages/host/src/api/updates'
import { coreRoutes } from '../../packages/host/src/core-routes'
import { getBootId } from '../../src/core/boot-id'
import { fingerprintOf } from '../../src/core/updates/inventory'
import { getUpdatesEngine, getUpdatesTimer, registerUpdateSource, resetUpdateSources, startUpdates, stopUpdates } from '../../src/core/updates/service'
import type { UpdateObservation, UpdateSource } from '../../src/core/updates/types'
import { waitUntil } from '../helpers/wait'

const call = (handler: (req: Request, url: URL) => Promise<Response>, method: string, path: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
  const url = new URL(`http://localhost${path}`)
  return handler(new Request(url, { method, ...init }), url)
}
/** The UI/CLI declare the operator (#898); a bare POST is an undeclared caller and is refused. */
const OPERATOR = { 'X-Bakin-Operator': 'declared' }

function scripted(kind: UpdateSource['kind'], ids: string[], observe: (id: string) => Promise<UpdateObservation>) {
  const calls: string[] = []
  const source: UpdateSource = {
    kind,
    inventory: async () => ids.map((id) => ({ subject: { kind, id, label: id }, group: 'available' as const, fingerprint: fingerprintOf({ id }), source: { kind: 's', endpoint: `s://${id}` } })),
    observe: async (entry) => { calls.push(entry.subject.id); return observe(entry.subject.id) },
  }
  return { source, calls }
}
const available = (id: string): UpdateObservation => ({ installed: { version: '1', display: '1' }, available: { version: '2', display: '2' }, reason: 'newer-version', outcome: 'update-available', action: { kind: 'operation', start: { route: `/api/updates/plugin%3A${id}/apply` }, impact: ['download'] } })
const current: UpdateObservation = { installed: { version: '1', display: '1' }, outcome: 'current' }

beforeEach(() => { broadcasts.length = 0 })
afterEach(() => { stopUpdates(); resetUpdateSources() })

describe('GET /api/updates', () => {
  it('is 503 before the engine starts, then the snapshot with the boot id', async () => {
    const before = await call(updatesRoute.list, 'GET', '/api/updates')
    expect(before.status).toBe(503)
    expect(await before.json()).toMatchObject({ bootId: getBootId(), error: 'updates_unavailable' })
    registerUpdateSource(scripted('plugin', ['projects'], async () => current).source)
    startUpdates(testDir)
    const res = await call(updatesRoute.list, 'GET', '/api/updates')
    expect(res.status).toBe(200)
    const body = await res.json() as { bootId: string; records: Array<{ id: string; outcome: string }>; running: boolean; generatedAt: string }
    expect(body.bootId).toBe(getBootId())
    expect(body.records.map((r) => [r.id, r.outcome])).toEqual([['plugin:projects', 'unknown']])
    expect(body.running).toBe(false)
    expect(typeof body.generatedAt).toBe('string')
  })
})

describe('POST /api/updates/check', () => {
  it('answers 202 at once and the pass lands as updates.changed; wait=1 answers 200 with the records', async () => {
    const plugins = scripted('plugin', ['projects', 'terminal'], async (id) => (id === 'projects' ? available(id) : current))
    registerUpdateSource(plugins.source)
    startUpdates(testDir)
    const res = await call(updatesRoute.check, 'POST', '/api/updates/check')
    expect(res.status).toBe(202)
    const body = await res.json() as { ids: string[]; coalesced: boolean; bootId: string }
    expect(body.ids.sort()).toEqual(['plugin:projects', 'plugin:terminal'])
    expect(body.bootId).toBe(getBootId())
    await waitUntil(() => plugins.calls.length === 2, { label: 'both subjects observed by the background pass' })
    await waitUntil(() => broadcasts.filter((b) => b.type === 'plugin-event' && b.event === 'updates.changed').length >= 2, { label: 'two updates.changed broadcasts' })

    const waited = await call(updatesRoute.check, 'POST', '/api/updates/check?wait=1&id=plugin%3Aprojects')
    expect(waited.status).toBe(200)
    const waitedBody = await waited.json() as { ids: string[]; records: Array<{ id: string; outcome: string }> }
    expect(waitedBody.ids).toEqual(['plugin:projects'])
    expect(waitedBody.records.find((r) => r.id === 'plugin:projects')?.outcome).toBe('update-available')
    expect(plugins.calls.filter((id) => id === 'projects').length).toBe(2)
  })

  it('filters by source kind, refuses an unknown kind (400) and an id outside the inventory (404) before anything runs', async () => {
    const plugins = scripted('plugin', ['projects'], async () => current)
    const packages = scripted('package', ['pack'], async () => current)
    registerUpdateSource(plugins.source)
    registerUpdateSource(packages.source)
    startUpdates(testDir)
    const kind = await call(updatesRoute.check, 'POST', '/api/updates/check?source=package&wait=1')
    expect(kind.status).toBe(200)
    expect((await kind.json() as { ids: string[] }).ids).toEqual(['package:pack'])
    expect(plugins.calls).toEqual([])
    expect((await call(updatesRoute.check, 'POST', '/api/updates/check?source=widgets')).status).toBe(400)
    const missing = await call(updatesRoute.check, 'POST', '/api/updates/check?id=plugin%3Anope')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: 'not_found', id: 'plugin:nope' })
    expect(plugins.calls).toEqual([])
  })
})

describe('POST /api/updates/:id/skip', () => {
  it('skips the current available identity, 409 when nothing is available, 404 for an unknown subject', async () => {
    registerUpdateSource(scripted('plugin', ['projects', 'terminal'], async (id) => (id === 'projects' ? available(id) : current)).source)
    startUpdates(testDir)
    await call(updatesRoute.check, 'POST', '/api/updates/check?wait=1')
    const skipped = await call(updatesRoute.skip, 'POST', '/api/updates/plugin%3Aprojects/skip')
    expect(skipped.status).toBe(200)
    expect(await skipped.json()).toMatchObject({ bootId: getBootId(), record: { id: 'plugin:projects', skipped: { version: '2' } } })
    const nothing = await call(updatesRoute.skip, 'POST', '/api/updates/plugin%3Aterminal/skip')
    expect(nothing.status).toBe(409)
    expect(await nothing.json()).toMatchObject({ error: 'nothing_to_skip', id: 'plugin:terminal' })
    expect((await call(updatesRoute.skip, 'POST', '/api/updates/plugin%3Anope/skip')).status).toBe(404)
  })

  it('the path matcher only accepts the skip shape', () => {
    expect(updatesRoute.skipUpdateIdFromPath('/api/updates/plugin%3Aprojects/skip')).toBe('plugin:projects')
    expect(updatesRoute.skipUpdateIdFromPath('/api/updates/check')).toBeNull()
    expect(updatesRoute.skipUpdateIdFromPath('/api/updates/plugin%3Aprojects/apply')).toBeNull()
  })
})

describe('route declarations', () => {
  it('the three updates routes are declared for the docs and validators', () => {
    const paths = coreRoutes.filter((route) => route.path.startsWith('/api/updates')).map((route) => `${route.method} ${route.path}`).sort()
    expect(paths).toEqual(['GET /api/updates', 'GET /api/updates/:id/apply-preview', 'POST /api/updates/:id/apply', 'POST /api/updates/:id/skip', 'POST /api/updates/check'])
  })
})

describe('GET /api/updates/:id/apply-preview and POST /api/updates/:id/apply', () => {
  it('404 for an unknown subject, 409 with the refusal code for nothing to apply, 403 with the refusal code for an agent', async () => {
    registerUpdateSource(scripted('plugin', ['projects', 'terminal'], async (id) => (id === 'projects' ? available(id) : current)).source)
    startUpdates(testDir)
    await call(updatesRoute.check, 'POST', '/api/updates/check?wait=1')
    const missing = await call(updatesRoute.applyPreview, 'GET', '/api/updates/plugin%3Anope/apply-preview')
    expect(missing.status).toBe(404)
    const preview = await call(updatesRoute.applyPreview, 'GET', '/api/updates/plugin%3Aprojects/apply-preview')
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({ bootId: getBootId(), preview: { id: 'plugin:projects', record: { outcome: 'update-available' }, action: { kind: 'operation' } } })
    const undeclared = await call(updatesRoute.apply, 'POST', '/api/updates/plugin%3Aterminal/apply')
    expect(undeclared.status).toBe(403)
    expect(await undeclared.json()).toMatchObject({ error: 'approval_decision', refusalCode: 'undeclared' })
    const nothing = await call(updatesRoute.apply, 'POST', '/api/updates/plugin%3Aterminal/apply', { headers: OPERATOR })
    expect(nothing.status).toBe(409)
    expect(await nothing.json()).toMatchObject({ bootId: getBootId(), error: 'nothing_to_apply' })
    const url = new URL('http://localhost/api/updates/plugin%3Aprojects/apply')
    const agent = await updatesRoute.apply(new Request(url, { method: 'POST', headers: { 'X-Bakin-Agent-Context': 'scout' }, body: '{}' }), url)
    expect(agent.status).toBe(403)
    expect(await agent.json()).toMatchObject({ error: 'approval_decision', refusalCode: expect.any(String) })
    const bad = await updatesRoute.apply(new Request(url, { method: 'POST', headers: OPERATOR, body: '{not json' }), url)
    expect(bad.status).toBe(400)
  })

  it('the path matchers only accept their own shapes', () => {
    expect(updatesRoute.applyPreviewIdFromPath('/api/updates/plugin%3Aprojects/apply-preview')).toBe('plugin:projects')
    expect(updatesRoute.applyIdFromPath('/api/updates/plugin%3Aprojects/apply')).toBe('plugin:projects')
    expect(updatesRoute.applyIdFromPath('/api/updates/plugin%3Aprojects/apply-preview')).toBeNull()
    expect(updatesRoute.skipUpdateIdFromPath('/api/updates/plugin%3Aprojects/apply')).toBeNull()
  })
})

describe('review round 2 — required skips and the reviewed target', () => {
  it('skipping a required update is 409 required; an apply without the reviewed target is 400 target_required', async () => {
    const required: UpdateSource = {
      kind: 'search-engine',
      inventory: async () => [{ subject: { kind: 'search-engine', id: 'antfly', label: 'Search engine' }, group: 'required', fingerprint: 'f', source: { kind: 'adapter', endpoint: 'antfly' } }],
      observe: async () => ({ installed: { version: '0.1.9', display: 'v0.1.9' }, available: { version: '0.2.5', display: 'v0.2.5' }, reason: 'pin-mismatch', outcome: 'update-available', action: { kind: 'operation', start: { route: '/api/updates/search-engine%3Aantfly/apply' }, impact: ['download'] } }),
    }
    registerUpdateSource(required)
    registerUpdateSource(scripted('plugin', ['projects'], async (id) => available(id)).source)
    startUpdates(testDir)
    await call(updatesRoute.check, 'POST', '/api/updates/check?wait=1')
    const refused = await call(updatesRoute.skip, 'POST', '/api/updates/search-engine%3Aantfly/skip')
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'required', id: 'search-engine:antfly' })
    const untargeted = await call(updatesRoute.apply, 'POST', '/api/updates/plugin%3Aprojects/apply', { headers: OPERATOR })
    expect(untargeted.status).toBe(400)
    expect(await untargeted.json()).toMatchObject({ error: 'target_required', available: { version: '2' } })
  })
})

describe('review round 3 — check ids against the live inventory', () => {
  it('a subject installed a moment ago is accepted (202); one that vanishes before a waited pass answers 404, never 500 (#9)', async () => {
    const ids = ['projects']
    const source: UpdateSource = {
      kind: 'plugin',
      inventory: async () => ids.map((id) => ({ subject: { kind: 'plugin' as const, id, label: id }, group: 'available' as const, fingerprint: `f:${id}`, source: { kind: 's', endpoint: id } })),
      observe: async (entry) => available(entry.subject.id),
    }
    registerUpdateSource(source)
    startUpdates(testDir)
    await getUpdatesEngine()!.ready
    ids.push('terminal')
    const fresh = await call(updatesRoute.check, 'POST', '/api/updates/check?id=plugin%3Aterminal')
    expect(fresh.status).toBe(202)
    ids.splice(1, 1)
    const gone = await call(updatesRoute.check, 'POST', '/api/updates/check?id=plugin%3Aterminal&wait=1')
    expect(gone.status).toBe(404)
    expect(await gone.json()).toMatchObject({ error: 'not_found', id: 'plugin:terminal' })
  })
})

describe('review round 4 — one admission path', () => {
  it('concurrent check requests never fan out inventory probes: ONE serialized enumeration per request, every subject observed once (#5)', async () => {
    let inventoryInFlight = 0
    let inventoryPeak = 0
    let inventoryCalls = 0
    const observed: string[] = []
    const source: UpdateSource = {
      kind: 'search-engine',
      inventory: async () => {
        inventoryCalls += 1
        inventoryInFlight += 1
        inventoryPeak = Math.max(inventoryPeak, inventoryInFlight)
        await new Promise((r) => setTimeout(r, 15)) // a binary version probe
        inventoryInFlight -= 1
        return [{ subject: { kind: 'search-engine' as const, id: 'antfly', label: 'antfly' }, group: 'required' as const, fingerprint: 'f', source: { kind: 's', endpoint: 'antfly' } }]
      },
      // Slow enough that every admission lands while the one pass is still on it.
      observe: async (entry) => { observed.push(entry.subject.id); await new Promise((r) => setTimeout(r, 150)); return current },
    }
    registerUpdateSource(source)
    startUpdates(testDir)
    await getUpdatesEngine()!.ready
    const boot = inventoryCalls
    const answers = await Promise.all([1, 2, 3].map(() => call(updatesRoute.check, 'POST', '/api/updates/check?wait=1')))
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200])
    expect(inventoryCalls - boot).toBe(3)
    expect(inventoryPeak).toBe(1)
    // Three requests joined one pass; the subject was looked at once for it.
    expect(observed).toEqual(['antfly'])
  })

  it('a subject removed AFTER it was admitted but before its turn answers 404 — the check never looked at it (#6)', async () => {
    const ids = ['a', 'b', 'c']
    const gates = new Map<string, () => void>()
    const source: UpdateSource = {
      kind: 'plugin',
      inventory: async () => ids.map((id) => ({ subject: { kind: 'plugin' as const, id, label: id }, group: 'available' as const, fingerprint: `f:${id}`, source: { kind: 's', endpoint: id } })),
      observe: async (entry) => {
        const id = entry.subject.id
        if (id === 'a' || id === 'b') await new Promise<void>((resolve) => gates.set(id, resolve))
        return current
      },
    }
    registerUpdateSource(source)
    startUpdates(testDir)
    const engine = getUpdatesEngine()!
    await engine.ready
    // Both workers busy on a and b; c is admitted and waits its turn.
    const broad = call(updatesRoute.check, 'POST', '/api/updates/check?id=plugin%3Aa&id=plugin%3Ab&wait=1')
    await waitUntil(() => gates.size === 2, { label: 'a and b in flight' })
    const queued = call(updatesRoute.check, 'POST', '/api/updates/check?id=plugin%3Ac&wait=1')
    await waitUntil(() => getUpdatesTimer()!.running(), { label: 'the pass is running' })
    // c is uninstalled while it waits; the inventory refreshes.
    ids.splice(2, 1)
    await engine.refreshInventory()
    for (const release of gates.values()) release()
    expect((await broad).status).toBe(200)
    const gone = await queued
    expect(gone.status).toBe(404)
    expect(await gone.json()).toMatchObject({ error: 'not_found', id: 'plugin:c' })
  })
})

describe('review round 5 — stop during admission', () => {
  it('a non-wait check whose admission refresh is in flight when the engine stops answers 503, never 202 (#6)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let held = false
    const observed: string[] = []
    const source: UpdateSource = {
      kind: 'plugin',
      inventory: async () => { if (held) await gate; return [{ subject: { kind: 'plugin' as const, id: 'projects', label: 'projects' }, group: 'available' as const, fingerprint: 'f', source: { kind: 's', endpoint: 'projects' } }] },
      observe: async (entry) => { observed.push(entry.subject.id); return current },
    }
    registerUpdateSource(source)
    startUpdates(testDir)
    await getUpdatesEngine()!.ready
    held = true
    const pending = call(updatesRoute.check, 'POST', '/api/updates/check')
    await new Promise((r) => setTimeout(r, 20))
    stopUpdates()
    release()
    const res = await pending
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'updates_unavailable' })
    expect(observed).toEqual([])
  })
})
