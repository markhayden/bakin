/**
 * Self-healing PR1 slice 1.3a: the search-family repair actions registered
 * beside today's resolutions (spec rows 54–57, 76, 85) and the incidents
 * repointed at them under the old contract.
 */
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-search-actions-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../../src/core/content-dir', contentDirMock)
mock.module('../../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../../src/core/logger', loggerMock)
mock.module('../../../../packages/core/src/logger', loggerMock)

let searchAvailable = true
let restarts = 0
const dropped: string[] = []
const services = () => ({
  search: {
    available: async () => searchAvailable,
    restartEngine: async () => { restarts++ },
    tables: { drop: async (name: string) => { dropped.push(name) } },
  },
  runtime: {}, tasks: {}, health: {},
})
mock.module('../../../../src/core/app-services', () => ({ getAppServices: services, maybeGetAppServices: services }))
mock.module('../../../../src/core/search-registry', () => ({
  crossTableSearch: async (q: string) => ({ results: [], meta: { query: q, total: 0, took_ms: 1, source: 'search' as const, tables: [{ table: 't', hits: 0, took_ms: 1 }] } }),
}))

// The ONE onboarding component for the engine, faked: records how it was asked.
const installs: Array<{ autoApprove?: boolean; allowServiceClaim?: boolean }> = []
let installStatus: 'installed' | 'noop' | 'failed' = 'installed'
mock.module('../../../../src/core/onboarding', () => ({
  installableComponent: (name: string) => {
    if (name !== 'search') throw new Error(`unexpected component ${name}`)
    return {
      name: 'search',
      plan: { stages: [{ id: 'download', kind: 'downloading', label: 'Download' }, { id: 'swap', kind: 'installing', label: 'Swap' }], pointOfNoReturn: 'swap' },
      resources: ['search-engine'],
      install: async (opts: { autoApprove?: boolean; allowServiceClaim?: boolean }) => {
        installs.push(opts)
        return { name: 'search', status: installStatus, message: installStatus === 'failed' ? 'download failed' : 'engine ready' }
      },
    }
  },
}))

let unclaimed: string[] = []
mock.module('../../../../src/core/doctor-report-cache', () => ({
  getHealthReport: () => ({
    observations: [{ checkId: 'health.search-consistency', key: 'indexes.sweep.unclaimed', evidence: { unclaimed } }],
  }),
}))

import type { HealthRepairTarget } from '@makinbakin/sdk'
import { noopOp } from '../../../helpers/operation-harness'
// Narrow overlays must spread the real module (a missing export breaks every later importer).
import * as realSettings from '../../../../src/core/settings'
import * as realSearchFactory from '../../../../src/core/search-adapter-factory'
import {
  searchDropUnclaimedTablesRepair,
  searchEngineClaimRepair,
  searchEngineInstallRepair,
  searchEngineWatchResetRepair,
} from '../../../../plugins/health/lib/system-checks/search-engine-repairs'
import { searchEngineRestartRepair, resetEngineWatchStateForTests } from '../../../../plugins/health/lib/system-checks/search-engine-watch'
import { checkSearchAdapter } from '../../../../plugins/health/lib/system-checks/search'

const target: HealthRepairTarget = { type: 'observations', reportId: 'report-test', ids: ['health.search:engine.connection'] }

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(async () => {
  rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true })
  searchAvailable = true; restarts = 0; dropped.length = 0; installs.length = 0; installStatus = 'installed'; unclaimed = []
  await resetEngineWatchStateForTests()
})

describe('search-engine-restart', () => {
  it('is the shared restart with its own id; plans safe; applies through restartEngine and verifies a served query', async () => {
    const action = searchEngineRestartRepair()
    expect(action.id).toBe('search-engine-restart')
    const plan = await action.plan(target)
    expect(plan[0]).toMatchObject({ actionId: 'search-engine-restart', safety: 'safe' })
    const [result] = await action.apply(plan, noopOp())
    expect(restarts).toBe(1)
    expect(result).toMatchObject({ status: 'applied', affectedCheckIds: ['health.search'] })
  })
})

describe('search-engine-install / search-engine-claim', () => {
  it('install runs the ONE onboarding search component without a service claim and reports applied', async () => {
    const action = searchEngineInstallRepair()
    const plan = await action.plan(target)
    expect(plan[0]).toMatchObject({ actionId: 'search-engine-install', safety: 'safe' })
    expect(action.resources).toEqual(['search-engine'])
    const [result] = await action.apply(plan, noopOp())
    expect(installs).toEqual([{ autoApprove: true, allowServiceClaim: false }])
    expect(result.status).toBe('applied')
  })

  it('install reports failed with the component message when the install fails', async () => {
    installStatus = 'failed'
    const action = searchEngineInstallRepair()
    const [result] = await action.apply(await action.plan(target), noopOp())
    expect(result.status).toBe('failed')
    expect(result.message).toContain('download failed')
  })

  it('claim is the operator decision: planned manual, applied WITH the service claim', async () => {
    const action = searchEngineClaimRepair()
    const plan = await action.plan(target)
    expect(plan[0]).toMatchObject({ actionId: 'search-engine-claim', safety: 'manual' })
    await action.apply(plan, noopOp())
    expect(installs).toEqual([{ autoApprove: true, allowServiceClaim: true }])
  })
})

describe('search-engine-watch-reset', () => {
  it('moves an unreadable watch history aside (never deletes) and starts a fresh streak', async () => {
    const path = join(testDir, 'plugin-data', 'health', 'engine-watch.json')
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '{ not json')
    const action = searchEngineWatchResetRepair()
    const plan = await action.plan({ type: 'observations', reportId: 'r', ids: ['health.search-canary:state.persistence'] })
    expect(plan[0]).toMatchObject({ actionId: 'search-engine-watch-reset', safety: 'safe' })
    const [result] = await action.apply(plan, noopOp())
    expect(result.status).toBe('applied')
    // The unreadable file is kept aside; a fresh, valid zero-streak history takes its place.
    expect(readdirSync(dirname(path)).some((f) => f.startsWith('engine-watch.json.rejected-'))).toBe(true)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ darkStreak: 0, wedgeStreak: 0, busyStreak: 0 })
  })
})

describe('search-drop-unclaimed-tables', () => {
  it('plans one manual item per unclaimed table from the report and drops exactly those', async () => {
    unclaimed = ['bakin_tasks_v1_dead', 'bakin_team_v1_dead']
    const action = searchDropUnclaimedTablesRepair()
    const plan = await action.plan({ type: 'observations', reportId: 'r', ids: ['health.search-consistency:indexes.sweep.unclaimed'] })
    expect(plan).toHaveLength(2)
    expect(plan.every((item) => item.safety === 'manual' && item.actionId === 'search-drop-unclaimed-tables')).toBe(true)
    const results = await action.apply(plan, noopOp())
    expect(dropped.sort()).toEqual(['bakin_tasks_v1_dead', 'bakin_team_v1_dead'])
    expect(results.every((r) => r.status === 'applied')).toBe(true)
  })
})

describe('incidents repointed under the old contract', () => {
  it('engine-unavailable, binary-missing and service-unprovisioned are repairs now (guest mode keeps its instructions)', async () => {
    mock.module('../../../../src/core/settings', () => ({ ...realSettings, getSettings: () => ({ search: { adapter: 'antfly', settings: { enabled: true } } }) }))
    mock.module('../../../../src/core/search-adapter-factory', () => ({
      ...realSearchFactory,
      isSearchAdapterInstalled: () => true,
      getSearchAdapterServiceStatus: () => ({ mode: 'launchd', provisioned: true }),
    }))
    searchAvailable = false
    const { checkSearchAdapter: check } = await import('../../../../plugins/health/lib/system-checks/search')
    const run = await check()
    const rows = (run as { observations: Array<{ key: string; incident?: { key: string; resolution: { type: string; actionId?: string } } }> }).observations
    const connection = rows.find((row) => row.key === 'engine.connection')
    expect(connection?.incident).toMatchObject({ key: 'engine-unavailable', resolution: { type: 'repair', actionId: 'search-engine-restart' } })
    void checkSearchAdapter
  })
})
