/**
 * PR5 success criteria (#895, PLAN § 5.3) for the search maintenance routes:
 * POST /api/reindex and POST /api/search/reset answer 202 in under 500ms even
 * while a background migration pass holds search-engine, wait for it
 * visibly, refuse cancel (neither is cancellable), and run once it is free.
 * The rebuild pass and the adapter reset are fakes; the routes, the process
 * operation registry and the resource locks are real (under a temp home).
 */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { OperationContext } from '@makinbakin/sdk/types'

const testDir = join(tmpdir(), `bakin-test-search-routes-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ search: { adapter: 'fake', settings: { enabled: true } } }),
}))
const ran: string[] = []
mock.module('../../src/core/search-adapter-factory', () => ({
  getSearchAdapterSetup: () => ({
    resetEngineData: async (op: OperationContext) => {
      for (const stage of ['stop', 'wipe', 'boot']) op.stage(stage)
      ran.push('reset')
      return { name: 'reset', status: 'installed', message: 'Engine reset clean and responding.', durationMs: 1 }
    },
  }),
}))
mock.module('../../src/core/search-registry', () => ({
  rebuildRegisteredTables: async () => {
    ran.push('reindex')
    return [{ table: 'bakin_tasks', result: 'unchanged', indexed: 1 }]
  },
}))

import { holdNow } from '@bakin/core/operations'
import { reindex, reset } from '../../packages/host/src/api/search/maintenance'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { waitUntil } from '../helpers/wait'

afterEach(() => {
  ran.length = 0
  _resetOperationRegistryForTests()
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const ROUTES = [
  { name: 'POST /api/reindex', start: () => reindex(new Request('http://x/api/reindex?force=1', { method: 'POST' }), new URL('http://x/api/reindex?force=1')), runs: ['reindex'] },
  { name: 'POST /api/search/reset', start: () => reset(new Request('http://x/api/search/reset', { method: 'POST' })), runs: ['reset', 'reindex'] },
]

describe('search maintenance routes: accept in under 500ms behind a background pass, wait visibly, refuse cancel', () => {
  for (const route of ROUTES) {
    it(route.name, async () => {
      let release!: () => void
      const pass = holdNow(['search-engine'], { title: 'Background index migration' }, () => new Promise<void>((resolve) => { release = resolve }))

      const startedAt = performance.now()
      const res = await route.start()
      const elapsedMs = performance.now() - startedAt
      expect(res.status).toBe(202)
      expect(elapsedMs).toBeLessThan(500)
      const { operationId } = await res.json() as { operationId: string }

      const registry = getOperationRegistry()
      await waitUntil(() => registry.get(operationId)?.waitingFor !== undefined, { label: `${route.name} waits for search-engine` })
      expect(registry.get(operationId)!.waitingFor!.holderTitle).toBe('Background index migration')
      expect(registry.cancel(operationId)).toBe('not_cancellable')
      expect(ran).toEqual([])

      release()
      await pass
      expect((await registry.await(operationId)).status).toBe('succeeded')
      expect(ran).toEqual(route.runs)
    })
  }
})
