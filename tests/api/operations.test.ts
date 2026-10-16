/**
 * The operations HTTP surface (#895 D3/D6/D9): list, get (children on
 * request), cancel with its full result matrix, every answer carrying the
 * boot id so clients can tell expired from restarted — plus the start helper
 * every converted route shares (202 within 500ms while the run is blocked,
 * 200 when attached, validation rejections keep today's status and body).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-api-operations-${Date.now()}-${randomUUID()}`)
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

import * as operationsRoute from '../../packages/host/src/api/operations'
import { coreRoutes } from '../../packages/host/src/core-routes'
import { buildOpenApiDocument } from '../../packages/host/src/api/docs-runtime'
import { collectOpenApiSources } from '../../packages/host/src/api/openapi-sources'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { getBootId } from '../../src/core/boot-id'
import { OperationRejectedError, type OperationPlan, type StartOperationInput } from '@bakin/core/operations'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  _resetOperationRegistryForTests()
})
afterEach(() => _resetOperationRegistryForTests())
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const PLAN: OperationPlan = {
  stages: [
    { id: 'download', kind: 'downloading', label: 'Download' },
    { id: 'commit', kind: 'committing', label: 'Commit' },
  ],
  pointOfNoReturn: 'commit',
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => { resolve = res })
  return { promise, resolve }
}

function input(over: Partial<StartOperationInput> = {}): StartOperationInput {
  return {
    kind: 'install', owner: 'core', origin: 'web', title: 'Install thing', fingerprint: `fp:${randomUUID()}`, plan: PLAN,
    run: async () => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true } }),
    ...over,
  }
}

const call = (handler: (req: Request, url: URL) => Promise<Response>, method: string, path: string) => {
  const url = new URL(`http://localhost${path}`)
  return handler(new Request(url, { method }), url)
}

describe('GET /api/operations', () => {
  it('answers the boot id and an empty list on a fresh boot', async () => {
    const res = await call(operationsRoute.list, 'GET', '/api/operations')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ bootId: getBootId(), operations: [] })
  })

  it('lists live operations', async () => {
    const gate = deferred()
    const { operationId } = await getOperationRegistry().start(input({ run: async () => { await gate.promise; return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null } } }))
    const body = await (await call(operationsRoute.list, 'GET', '/api/operations')).json()
    expect(body.operations.map((v: { id: string }) => v.id)).toEqual([operationId])
    gate.resolve()
    await getOperationRegistry().await(operationId)
  })
})

describe('GET /api/operations/:id', () => {
  it('returns the complete view, and children only when asked', async () => {
    const { operationId } = await getOperationRegistry().start(input())
    await getOperationRegistry().await(operationId)

    const plain = await (await call(operationsRoute.get, 'GET', `/api/operations/${operationId}`)).json()
    expect(plain.bootId).toBe(getBootId())
    expect(plain.operation).toMatchObject({ id: operationId, status: 'succeeded', result: { httpStatus: 200, body: { ok: true } } })
    expect(plain.children).toBeUndefined()

    const withChildren = await (await call(operationsRoute.get, 'GET', `/api/operations/${operationId}?children=1`)).json()
    expect(withChildren.children).toEqual([])
  })

  it('answers 404 with the current boot id so a client can tell expired from restarted', async () => {
    const res = await call(operationsRoute.get, 'GET', '/api/operations/from-another-boot')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ bootId: getBootId(), error: 'not_found' })
  })
})

describe('POST /api/operations/:id/cancel', () => {
  it('202 cancelling for a cancellable operation, then 409 already_finished', async () => {
    const entered = deferred()
    const { operationId } = await getOperationRegistry().start(input({
      run: async (op) => {
        op.stage('download')
        entered.resolve()
        await new Promise<void>((r) => op.signal.addEventListener('abort', () => r()))
        op.throwIfCancelled()
        return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null }
      },
    }))
    await entered.promise
    const res = await call(operationsRoute.cancel, 'POST', `/api/operations/${operationId}/cancel`)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ bootId: getBootId(), status: 'cancelling' })

    await getOperationRegistry().await(operationId)
    const again = await call(operationsRoute.cancel, 'POST', `/api/operations/${operationId}/cancel`)
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ bootId: getBootId(), status: 'already_finished' })
  })

  it('409 not_cancellable past the point of no return', async () => {
    const entered = deferred()
    const gate = deferred()
    const { operationId } = await getOperationRegistry().start(input({
      run: async (op) => { op.stage('commit'); entered.resolve(); await gate.promise; return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null } },
    }))
    await entered.promise
    const res = await call(operationsRoute.cancel, 'POST', `/api/operations/${operationId}/cancel`)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ bootId: getBootId(), status: 'not_cancellable' })
    gate.resolve()
    await getOperationRegistry().await(operationId)
  })

  it('404 with the boot id for an unknown operation', async () => {
    const res = await call(operationsRoute.cancel, 'POST', '/api/operations/nope/cancel')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ bootId: getBootId(), status: 'not_found' })
  })
})

describe('startOperationResponse — the shared converted-route start', () => {
  it('accepts within 500ms while the run is blocked (success criterion 1)', async () => {
    const never = new Promise<never>(() => {})
    const started = performance.now()
    const res = await operationsRoute.startOperationResponse(input({ run: async () => never }))
    expect(performance.now() - started).toBeLessThan(500)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ operationId: expect.any(String), bootId: getBootId() })
  })

  it('accepts within 500ms while another operation holds its resource', async () => {
    const gate = deferred()
    await getOperationRegistry().start(input({ resources: ['media-store'], run: async () => { await gate.promise; return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null } } }))
    const started = performance.now()
    const res = await operationsRoute.startOperationResponse(input({ resources: ['media-store'] }))
    expect(performance.now() - started).toBeLessThan(500)
    expect(res.status).toBe(202)
    gate.resolve()
  })

  it('answers 200 attached for an identical live request', async () => {
    const gate = deferred()
    const shared = input({ fingerprint: 'same', run: async () => { await gate.promise; return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null } } })
    const first = await (await operationsRoute.startOperationResponse(shared)).json()
    const res = await operationsRoute.startOperationResponse(shared)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ operationId: first.operationId, bootId: getBootId(), attached: true })
    gate.resolve()
  })

  it("keeps today's status and body for a validation rejection", async () => {
    const res = await operationsRoute.startOperationResponse(input({
      validate: () => { throw new OperationRejectedError(409, { ok: false, error: 'already installed' }) },
    }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ ok: false, error: 'already installed' })
    expect(getOperationRegistry().list()).toEqual([])
  })

  it('rethrows unexpected validation failures for the route error handler', async () => {
    await expect(operationsRoute.startOperationResponse(input({ validate: () => { throw new Error('bug') } }))).rejects.toThrow('bug')
  })
})

describe('origin from the request', () => {
  it('is cli only when the CLI says so, web otherwise', () => {
    const req = (headers: Record<string, string> = {}) => new Request('http://localhost/x', { headers })
    expect(operationsRoute.operationOriginFromRequest(req({ 'X-Bakin-Origin': 'cli' }))).toBe('cli')
    expect(operationsRoute.operationOriginFromRequest(req())).toBe('web')
    expect(operationsRoute.operationOriginFromRequest(req({ 'X-Bakin-Origin': 'system' }))).toBe('web')
  })
})

describe('route metadata', () => {
  it('declares the operations routes, polling GETs as routine', () => {
    const declared = coreRoutes.filter((r) => r.path.startsWith('/api/operations')).map((r) => `${r.method} ${r.path} ${r.activityClass ?? ''}`.trim())
    expect(declared.sort()).toEqual([
      'GET /api/operations routine',
      'GET /api/operations/:id routine',
      'POST /api/operations/:id/cancel',
    ])
  })

  it('publishes them in the generated OpenAPI document', () => {
    const paths = Object.keys(buildOpenApiDocument(collectOpenApiSources([])).paths)
    expect(paths).toEqual(expect.arrayContaining(['/api/operations', '/api/operations/{id}', '/api/operations/{id}/cancel']))
  })
})
