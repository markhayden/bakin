/**
 * PR6 success criteria (#895, PLAN § 6.2) for POST
 * /api/runtime/onboarding/install: explicit options, nothing auto-approved,
 * a service claim only with this home's lock secret, CLI-started operations
 * attributed to the CLI (the tray shows them), and the server run is the same
 * operation the CLI runs in-process — for media, search, search-models,
 * plugin-assets and agent-sync. Components are fakes with their real
 * resources; the route, the registry and the resource locks are real.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { OperationContext } from '@makinbakin/sdk/types'

const testDir = join(tmpdir(), `bakin-test-onboarding-route-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const paths = () => ({ home: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))
mock.module('../../src/core/audit', () => ({ appendAudit: () => {} }))

const RESOURCES: Record<string, string[]> = {
  media: ['media-store'],
  search: ['search-engine'],
  'search-models': ['search-engine'],
  'plugin-assets': ['install-state'],
  'agent-sync': ['install-state'],
}
const received: Array<{ name: string; options: Record<string, unknown> }> = []
function fake(name: string) {
  return {
    name,
    plan: { stages: [{ id: 'run', kind: 'installing' as const, label: `Set up ${name}` }], pointOfNoReturn: 'run' },
    resources: RESOURCES[name] ?? [],
    check: async () => ({ name, status: 'missing' as const, message: 'missing' }),
    install: async (options: Record<string, unknown>, op: OperationContext) => {
      received.push({ name, options })
      op.stage('run')
      return { name, status: 'installed' as const, message: `${name} installed`, durationMs: 0 }
    },
  }
}
mock.module('../../src/core/onboarding/index', () => ({ installableComponent: (name: string) => fake(name) }))

import { acquireServerLock, CLI_SECRET_HEADER, readServerLock, releaseServerLock } from '../../src/core/server-lock'
import { install } from '../../packages/host/src/api/runtime/onboarding'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { runComponentInstall } from '../../src/cli/component-install'
import { silentOperationRenderer } from '../../src/cli/operation-renderer'

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return install(new Request('http://localhost/api/runtime/onboarding/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
}

async function startAndSettle(body: unknown, headers: Record<string, string> = {}) {
  const res = await post(body, headers)
  expect(res.status).toBe(202)
  const { operationId } = await res.json() as { operationId: string }
  return getOperationRegistry().await(operationId)
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  received.length = 0
  _resetOperationRegistryForTests()
})
afterEach(() => {
  releaseServerLock()
  _resetOperationRegistryForTests()
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('POST /api/runtime/onboarding/install', () => {
  it('answers 400 for an unknown or check-only component and for unknown options — nothing starts', async () => {
    expect((await post({ component: 'nope' })).status).toBe(400)
    expect((await post({ component: 'runtime' })).status).toBe(400)
    expect((await post({ component: 'media', options: { interactive: true } })).status).toBe(400)
    expect(getOperationRegistry().list()).toEqual([])
  })

  it('never auto-approves: the component gets exactly the options sent', async () => {
    await startAndSettle({ component: 'media' })
    expect(received).toEqual([{ name: 'media', options: { autoApprove: false, allowServiceClaim: false } }])
  })

  it('refuses a service claim without the lock secret and with a wrong one (403, nothing starts)', async () => {
    expect(acquireServerLock(3737, 'boot-route').acquired).toBe(true)
    const claim = { component: 'search', options: { autoApprove: true, allowServiceClaim: true } }
    expect((await post(claim)).status).toBe(403)
    expect((await post(claim, { [CLI_SECRET_HEADER]: 'f'.repeat(64) })).status).toBe(403)
    expect(getOperationRegistry().list()).toEqual([])
    expect(received).toEqual([])
  })

  it('honours a service claim with the secret this server wrote into its lock', async () => {
    expect(acquireServerLock(3737, 'boot-route').acquired).toBe(true)
    const view = await startAndSettle(
      { component: 'search', options: { autoApprove: true, allowServiceClaim: true } },
      { [CLI_SECRET_HEADER]: readServerLock()!.cliSecret! },
    )
    expect(view.status).toBe('succeeded')
    expect(received).toEqual([{ name: 'search', options: { autoApprove: true, allowServiceClaim: true } }])
  })

  it('attributes a CLI-started install to the CLI — the tray lists it like any operation', async () => {
    const res = await post({ component: 'media', options: { autoApprove: true } }, { 'X-Bakin-Origin': 'cli' })
    const { operationId } = await res.json() as { operationId: string }
    expect(getOperationRegistry().list().map((v) => [v.id, v.origin])).toContainEqual([operationId, 'cli'])
    await getOperationRegistry().await(operationId)
  })
})

describe('server/local parity (#895 D11)', () => {
  for (const name of ['media', 'search', 'search-models', 'plugin-assets', 'agent-sync'] as const) {
    it(`${name}: the server run and the in-process run are the same operation`, async () => {
      const options = { autoApprove: true, allowServiceClaim: false }
      const server = await startAndSettle({ component: name, options }, { 'X-Bakin-Origin': 'cli' })
      const local = await runComponentInstall(name, options, { mode: { kind: 'local' }, renderer: silentOperationRenderer(() => {}) })
      const localView = local.follow.operation!

      const shape = (v: typeof server) => ({
        kind: v.kind, origin: v.origin, title: v.title, fingerprint: v.fingerprint, resources: v.resources,
        stages: v.stages.map((s) => [s.id, s.status]), status: v.status, outcome: v.outcome?.code, body: v.result?.body,
      })
      expect(shape(localView)).toEqual(shape(server))
      expect(server.resources).toEqual(RESOURCES[name])
      expect(local.result).toEqual({ name, status: 'installed', message: `${name} installed`, durationMs: 0 })
      expect(received.map((r) => r.options)).toEqual([options, options])
    })
  }
})
