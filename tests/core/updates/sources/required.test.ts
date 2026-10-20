/** The required-row sources: search engine, search models, gateway floor — mapped from structured adapter verdicts only (#1007 D7.9/D7.10). */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-required-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../../src/core/content-dir', contentDirMock)
mock.module('../../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../../src/core/logger', loggerMock)
mock.module('../../../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import type { SearchAdapterModelCheck, SearchAdapterSetup, SearchAdapterSetupCheckResult } from '@bakin/core/adapters/search'
import { createMockRuntimeAdapter, mockCompatibility } from '@bakin/core/adapters/runtime/testing'
import { createUpdatesEngine } from '../../../../src/core/updates/engine'
import { createGatewaySource } from '../../../../src/core/updates/sources/gateway'
import { createSearchEngineSource, type SearchSettingsFacts } from '../../../../src/core/updates/sources/search-engine'
import { createSearchModelsSource } from '../../../../src/core/updates/sources/search-models'

const PLAN = { stages: [], pointOfNoReturn: null } as unknown as SearchAdapterSetup['dependency']['plan']
const settings = (overrides: Partial<SearchSettingsFacts> = {}): SearchSettingsFacts => ({ adapter: 'antfly', url: 'http://127.0.0.1:3738', enabled: true, requiredModelIds: ['a/b'], ...overrides })

/** A fake setup whose checks answer scripted results and record the signal they were given. */
function fakeSetup(dependency: () => SearchAdapterSetupCheckResult, models?: () => SearchAdapterSetupCheckResult) {
  const signals: AbortSignal[] = []
  const setup: SearchAdapterSetup = {
    dependency: { name: 'antfly', plan: PLAN, check: async (opts) => { if (opts?.signal) signals.push(opts.signal); return dependency() }, install: async () => { throw new Error('not installed in tests') } },
    ...(models ? { models: { name: 'models', plan: PLAN, check: async (opts) => { if (opts?.signal) signals.push(opts.signal); return models() }, install: async () => { throw new Error('x') } } } : {}),
  }
  return { setup, signals }
}

const engineOk = (identity = 'id-1'): SearchAdapterSetupCheckResult => ({ name: 'antfly', status: 'ok', message: 'ok', applicable: true, installed: { version: '0.2.5', identity }, required: { version: '0.2.5' } })
const engineBroken: SearchAdapterSetupCheckResult = { name: 'antfly', status: 'broken', message: 'v0.2.4 but needs v0.2.5', remediation: 'Run `bakin install search`', applicable: true, installed: { version: '0.2.4', identity: 'id-old' }, required: { version: '0.2.5' } }
const engineMissing: SearchAdapterSetupCheckResult = { name: 'antfly', status: 'missing', message: 'Antfly binary not found', remediation: 'Run `bakin install search`', applicable: true, required: { version: '0.2.5' } }
const engineGuest: SearchAdapterSetupCheckResult = { name: 'antfly', status: 'ok', message: 'guest', applicable: false }
const engineUnclaimed: SearchAdapterSetupCheckResult = { name: 'antfly', status: 'missing', message: 'service belongs to no home yet', remediation: 'bakin install search claims it', applicable: true, installed: { version: '0.2.5', identity: 'id-1' }, required: { version: '0.2.5' } }
const engineErr: SearchAdapterSetupCheckResult = { name: 'antfly', status: 'error', message: 'ANTFLY_PATH points elsewhere', applicable: true, installed: { version: '0.2.5', identity: 'id-x' }, required: { version: '0.2.5' } }

const row = (id: string, state: SearchAdapterModelCheck['state'], remediation?: SearchAdapterModelCheck['remediation'], extra: Partial<SearchAdapterModelCheck> = {}): SearchAdapterModelCheck =>
  ({ id, label: id, required: { identity: `req-${id}` }, installed: state === 'missing' ? undefined : { identity: `inst-${id}` }, state, ...(remediation ? { remediation } : {}), ...extra })
const modelsResult = (status: SearchAdapterSetupCheckResult['status'], models: SearchAdapterModelCheck[], remediation?: string): SearchAdapterSetupCheckResult =>
  ({ name: 'models', status, message: status, applicable: true, models, ...(remediation ? { remediation } : {}) })

describe('search-engine source', () => {
  it('a pinned, present engine is current; a wrong version or a missing binary is a required pin-mismatch with the install action', async () => {
    const ok = createSearchEngineSource({ setup: () => fakeSetup(() => engineOk()).setup, settings })
    const [entry] = await ok.inventory()
    expect(entry).toMatchObject({ subject: { kind: 'search-engine', id: 'antfly' }, group: 'required', source: { kind: 'adapter', endpoint: 'antfly' } })
    expect(await ok.observe(entry!, { signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })).toMatchObject({ outcome: 'current', installed: { version: '0.2.5', display: 'v0.2.5' } })

    for (const result of [engineBroken, engineMissing]) {
      const source = createSearchEngineSource({ setup: () => fakeSetup(() => result).setup, settings })
      const [e] = await source.inventory()
      const observation = await source.observe(e!, { signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })
      expect(observation).toMatchObject({ outcome: 'update-available', reason: 'pin-mismatch', available: { version: '0.2.5' }, action: { kind: 'operation', start: { route: '/api/updates/search-engine%3Aantfly/apply' }, impact: ['download', 'search-interruption', 'reindex'] } })
    }
    const missing = createSearchEngineSource({ setup: () => fakeSetup(() => engineMissing).setup, settings })
    expect((await missing.observe((await missing.inventory())[0]!, { signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })).installed).toEqual({ display: 'not installed' })
  })

  it('not applicable (guest endpoint, disabled search, no adapter) ⇒ no subject at all', async () => {
    expect(await createSearchEngineSource({ setup: () => fakeSetup(() => engineGuest).setup, settings }).inventory()).toEqual([])
    expect(await createSearchEngineSource({ setup: () => fakeSetup(() => engineOk()).setup, settings: () => settings({ enabled: false }) }).inventory()).toEqual([])
    expect(await createSearchEngineSource({ setup: () => null, settings }).inventory()).toEqual([])
  })

  it('an unclaimed service or a path override is blocked with the adapter\'s own remediation, never an install', async () => {
    for (const result of [engineUnclaimed, engineErr]) {
      const source = createSearchEngineSource({ setup: () => fakeSetup(() => result).setup, settings })
      const observation = await source.observe((await source.inventory())[0]!, { signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })
      expect(observation.outcome).toBe('blocked')
      expect(observation.action?.kind).toBe('manual')
      expect(observation.blockedReason).toBe(result.message)
    }
  })

  it('the fingerprint moves with the installed identity, the required pin and the search settings — and the check receives the observe signal', async () => {
    let identity = 'id-1'
    const fake = fakeSetup(() => engineOk(identity))
    let facts = settings()
    const source = createSearchEngineSource({ setup: () => fake.setup, settings: () => facts })
    const a = (await source.inventory())[0]!.fingerprint
    identity = 'id-2'
    const b = (await source.inventory())[0]!.fingerprint
    facts = settings({ requiredModelIds: ['a/b', 'c/d'] })
    const c = (await source.inventory())[0]!.fingerprint
    expect(new Set([a, b, c]).size).toBe(3)
    const controller = new AbortController()
    await source.observe((await source.inventory())[0]!, { signal: controller.signal, conditional: { get: () => undefined, set: () => {} } })
    expect(fake.signals.at(-1)).toBe(controller.signal)
  })

  it('an engine replaced offline shows up at the next boot as unknown + "inventory changed", due now', async () => {
    let identity = 'id-1'
    const makeSource = () => createSearchEngineSource({ setup: () => fakeSetup(() => engineOk(identity)).setup, settings })
    const path = join(testDir, 'engine-offline.json')
    const first = createUpdatesEngine({ storePath: path, sources: [makeSource()], intervalMs: 3_600_000 })
    const observed = await first.observe('search-engine:antfly')
    expect(observed.outcome).toBe('current')
    identity = 'id-2' // replaced while Bakin was down
    const second = createUpdatesEngine({ storePath: path, sources: [makeSource()], intervalMs: 3_600_000 })
    const record = (await second.snapshot()).records[0]!
    expect(record.outcome).toBe('unknown')
    expect(record.attempt?.error).toBe('inventory changed')
    expect(await second.dueSubjects()).toEqual(['search-engine:antfly'])
    expect((await second.observe('search-engine:antfly')).outcome).toBe('current')
  })
})

describe('search-models source', () => {
  const ctx = () => ({ signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })

  it('every model ok ⇒ current with the ready count; a partial set ⇒ required pin-mismatch with the models install action', async () => {
    const ok = createSearchModelsSource({ setup: () => fakeSetup(() => engineOk(), () => modelsResult('ok', [row('a/b', 'ok'), row('c/d', 'ok')])).setup, settings })
    const [entry] = await ok.inventory()
    expect(entry).toMatchObject({ subject: { kind: 'search-models', id: 'antfly' }, group: 'required' })
    expect(await ok.observe(entry!, ctx())).toMatchObject({ outcome: 'current', installed: { display: '2 of 2 models ready' } })

    const partial = createSearchModelsSource({ setup: () => fakeSetup(() => engineOk(), () => modelsResult('missing', [row('a/b', 'ok'), row('c/d', 'missing', 'install', { reason: 'not downloaded yet' })])).setup, settings })
    const observation = await partial.observe((await partial.inventory())[0]!, ctx())
    expect(observation).toMatchObject({ outcome: 'update-available', reason: 'pin-mismatch', installed: { display: '1 of 2 models ready' }, action: { kind: 'operation', start: { route: '/api/updates/search-models%3Aantfly/apply' }, impact: ['download'] } })
    expect(observation.blockedReason).toBeUndefined()
  })

  it('each remediation maps to the right outcome: install and replace-variant are actionable; change-config and unsupported block', async () => {
    const cases: Array<[SearchAdapterModelCheck, 'update-available' | 'blocked']> = [
      [row('a/b', 'unloadable', 'install', { reason: 'error.MissingWeight' }), 'update-available'],
      [row('a/b', 'variant-mismatch', 'replace-variant', { reason: 'installed as the default distribution, not gguf:Q4_K' }), 'update-available'],
      [row('a/b', 'unloadable', 'replace-variant', { reason: 'wrong variant; cannot load' }), 'update-available'],
      [row('a/b', 'unsupported', 'change-config', { reason: 'the engine cannot run it here' }), 'blocked'],
      [row('a/b', 'unsupported', 'unsupported', { reason: 'no' }), 'blocked'],
    ]
    for (const [model, outcome] of cases) {
      const source = createSearchModelsSource({ setup: () => fakeSetup(() => engineOk(), () => modelsResult('warn', [model], 'Point that embedder at a model that loads here.')).setup, settings })
      const observation = await source.observe((await source.inventory())[0]!, ctx())
      expect({ remediation: model.remediation, outcome: observation.outcome }).toEqual({ remediation: model.remediation, outcome })
      if (outcome === 'blocked') {
        expect(observation.blockedReason).toContain(model.reason!)
        expect(observation.action).toEqual({ kind: 'manual', pointer: 'Point that embedder at a model that loads here.' })
      }
    }
  })

  it('an actionable model beside an unsupported custom one is offered, with the unsupported one named as not installable', async () => {
    const source = createSearchModelsSource({ setup: () => fakeSetup(() => engineOk(), () => modelsResult('missing', [row('a/b', 'missing', 'install'), row('me/custom', 'unsupported', 'change-config', { reason: 'cannot load here' })])).setup, settings })
    const observation = await source.observe((await source.inventory())[0]!, ctx())
    expect(observation.outcome).toBe('update-available')
    expect(observation.blockedReason).toContain('me/custom: cannot load here')
  })

  it('no models component, an external endpoint, or disabled search ⇒ no subject; the fingerprint moves with any model identity or state', async () => {
    expect(await createSearchModelsSource({ setup: () => fakeSetup(() => engineOk()).setup, settings }).inventory()).toEqual([])
    expect(await createSearchModelsSource({ setup: () => fakeSetup(() => engineOk(), () => ({ name: 'models', status: 'ok', message: 'external', applicable: false, models: [] })).setup, settings }).inventory()).toEqual([])
    expect(await createSearchModelsSource({ setup: () => fakeSetup(() => engineOk(), () => modelsResult('ok', [row('a/b', 'ok')])).setup, settings: () => settings({ enabled: false }) }).inventory()).toEqual([])
    let rows = [row('a/b', 'ok')]
    const source = createSearchModelsSource({ setup: () => fakeSetup(() => engineOk(), () => modelsResult('ok', rows)).setup, settings })
    const a = (await source.inventory())[0]!.fingerprint
    rows = [row('a/b', 'ok', undefined, { installed: { identity: 'inst-a/b-v2' } })]
    const b = (await source.inventory())[0]!.fingerprint
    rows = [row('a/b', 'missing', 'install')]
    const c = (await source.inventory())[0]!.fingerprint
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('gateway source', () => {
  const ctx = () => ({ signal: new AbortController().signal, conditional: { get: () => undefined, set: () => {} } })

  it('a runtime without compatibility() lists no subject', async () => {
    const source = createGatewaySource({ runtime: () => createMockRuntimeAdapter() })
    expect(await source.inventory()).toEqual([])
  })

  it('ok ⇒ current; below the floor ⇒ required below-floor with a manual pointer; unknown ⇒ unknown', async () => {
    const at = '2026-10-20T12:00:00.000Z'
    const ok = createGatewaySource({ runtime: () => createMockRuntimeAdapter({ compatibility: mockCompatibility({ required: '4', observed: '4', observedAt: at, state: 'ok' }) }) })
    const [entry] = await ok.inventory()
    const name = createMockRuntimeAdapter().name
    expect(entry).toMatchObject({ subject: { kind: 'gateway', id: name }, group: 'required', source: { kind: 'runtime', endpoint: name } })
    expect(await ok.observe(entry!, ctx())).toMatchObject({ outcome: 'current', installed: { version: '4', display: 'protocol 4' } })

    const below = createGatewaySource({ runtime: () => createMockRuntimeAdapter({ compatibility: mockCompatibility({ required: '4', observed: '3', observedAt: at, state: 'below-floor' }) }) })
    const observation = await below.observe((await below.inventory())[0]!, ctx())
    expect(observation).toMatchObject({ outcome: 'update-available', reason: 'below-floor', installed: { version: '3' }, available: { version: '4', display: 'protocol 4' } })
    expect(observation.action?.kind).toBe('manual')

    const unknown = createGatewaySource({ runtime: () => createMockRuntimeAdapter({ compatibility: mockCompatibility({ required: '4', state: 'unknown' }) }) })
    expect((await unknown.observe((await unknown.inventory())[0]!, ctx())).outcome).toBe('unknown')
  })
})

describe('review round 3 — the models offer has an identity (#5)', () => {
  it('available.digest is the sorted required model set, stable across row order and moving with a pin', async () => {
    const { modelsDigest } = await import('../../../../src/core/updates/sources/search-models')
    const a = { id: 'bge-small', label: 'bge-small', required: { identity: 'pin-1' }, state: 'missing' as const, remediation: 'install' as const }
    const b = { id: 'bge-m3', label: 'bge-m3', required: { identity: 'pin-2' }, state: 'ok' as const }
    expect(modelsDigest([a, b])).toBe(modelsDigest([b, a]))
    expect(modelsDigest([a, b])).not.toBe(modelsDigest([{ ...a, required: { identity: 'pin-9' } }, b]))
    const { observeSearchModels } = await import('../../../../src/core/updates/sources/search-models')
    const offer = observeSearchModels('antfly', { name: 'antfly', status: 'broken', message: 'x', applicable: true, models: [a, b] })
    expect(offer.available?.digest).toBe(modelsDigest([a, b]))
  })
})
