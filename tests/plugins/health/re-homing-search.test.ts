/**
 * Re-homing table rows 52–89 (search family) under the three-outcomes
 * contract (self-healing PR1 1.7): every row's declared family sits in its
 * check's catalog with the table's resolution and requirement, every search
 * repair action declares the table's effects (→ mode), and the rows the
 * `health.search` harness can reach are emitted exactly as declared.
 * Rows 70–89 are emitted by search-engine-watch.test.ts /
 * search-spin.test.ts; their catalogs and actions are pinned here.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-rehoming-search-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

let searchAvailable = true
let searchEnabled = true
let serviceStatus: Record<string, unknown> = { mode: 'launchd', provisioned: true }
let serviceStatusError: Error | null = null
let binaryInstalled = true
let outbox = { pending: 0, quarantined: 0, oldestPendingEnqueuedAt: null as number | null }
const services = () => ({
  search: {
    available: async () => searchAvailable,
    capabilities: () => ({ legs: ['text-embedding', 'media-embedding'] }),
    tables: {},
  },
  runtime: {}, tasks: {}, health: {},
})
mock.module('../../../src/core/app-services', () => ({ getAppServices: services, maybeGetAppServices: services }))
mock.module('../../../src/core/search-registry', () => ({ getRegistry: () => ({ contentTypes: new Map() }) }))
mock.module('../../../src/core/search-reindex', () => ({ getSearchHealth: async () => ({ enabled: true, engineReachable: searchAvailable, tables: [] }) }))
mock.module('../../../src/core/search-outbox', () => ({
  outboxStats: () => outbox,
  listQuarantined: () => (outbox.quarantined > 0 ? [{ logicalTable: 'bakin_tasks' }] : []),
}))
import * as realSettings from '../../../src/core/settings'
mock.module('../../../src/core/settings', () => ({ ...realSettings, getSettings: () => ({ search: { adapter: 'antfly', settings: { enabled: searchEnabled } } }) }))
import * as realSearchFactory from '../../../src/core/search-adapter-factory'
mock.module('../../../src/core/search-adapter-factory', () => ({
  ...realSearchFactory,
  isSearchAdapterInstalled: () => binaryInstalled,
  getSearchAdapterServiceStatus: () => { if (serviceStatusError) throw serviceStatusError; return serviceStatus },
}))

import type { HealthIncidentDeclaration, HealthMutationKind, HealthObservationInput, HealthRepairActionDefinition, HealthRepairEffects } from '@makinbakin/sdk'
import { repairMode } from '@bakin/core/health/repair-mode'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'
import { SEARCH_INCIDENTS, checkSearchAdapter, searchScarRepair } from '../../../plugins/health/lib/system-checks/search'
import { SEARCH_CONSISTENCY_INCIDENTS, searchConsistencyRepair } from '../../../plugins/health/lib/system-checks/search-consistency'
import { SEARCH_SPIN_INCIDENTS, searchSpinRepair } from '../../../plugins/health/lib/system-checks/search-spin'
import { searchOutboxRepair } from '../../../plugins/health/lib/system-checks/search-outbox'
import {
  SEARCH_CANARY_INCIDENTS,
  SEARCH_ENGINE_BURN_INCIDENTS,
  searchCanaryRepair,
  searchConsistencyRestartRepair,
  searchEngineBurnRepair,
  searchEngineRestartRepair,
} from '../../../plugins/health/lib/system-checks/search-engine-watch'
import {
  searchDropUnclaimedTablesRepair,
  searchEngineClaimRepair,
  searchEngineInstallRepair,
  searchEngineWatchResetRepair,
} from '../../../plugins/health/lib/system-checks/search-engine-repairs'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true })
  searchAvailable = true; searchEnabled = true; binaryInstalled = true
  serviceStatus = { mode: 'launchd', provisioned: true }
  serviceStatusError = null
  outbox = { pending: 0, quarantined: 0, oldestPendingEnqueuedAt: null }
})

type Family = HealthIncidentDeclaration
const repair = (actionId: string): HealthIncidentDeclaration['resolution'] => ({ type: 'repair', actionId })
const human = (needs: 'credential' | 'payment' | 'decision' | 'external-install'): HealthIncidentDeclaration['resolution'] => ({ type: 'human', needs })

/** The table, row by row — a family per repair/human row; observation rows have none. */
const TABLE: Array<{ row: number; catalog: HealthIncidentDeclaration[]; family: Family }> = [
  { row: 54, catalog: SEARCH_INCIDENTS, family: { id: 'service-ownership-claim', subjectKind: 'service', resolution: repair('search-engine-claim'), required: 'always' } },
  { row: 54, catalog: SEARCH_INCIDENTS, family: { id: 'service-ownership', subjectKind: 'service', resolution: human('decision'), required: 'always' } },
  { row: 55, catalog: SEARCH_INCIDENTS, family: { id: 'binary-missing', subjectKind: 'service', resolution: repair('search-engine-install'), required: 'always' } },
  { row: 56, catalog: SEARCH_INCIDENTS, family: { id: 'service-unprovisioned', subjectKind: 'service', resolution: repair('search-engine-install'), required: 'always' } },
  { row: 57, catalog: SEARCH_INCIDENTS, family: { id: 'engine-unavailable', subjectKind: 'service', resolution: repair('search-engine-restart'), required: 'always' } },
  { row: 57, catalog: SEARCH_INCIDENTS, family: { id: 'engine-unavailable-guest', subjectKind: 'service', resolution: human('decision'), required: 'always' } },
  { row: 64, catalog: SEARCH_INCIDENTS, family: { id: 'table-scars', subjectKind: 'service', resolution: repair('search-scar-rebuild'), required: 'never' } },
  { row: 67, catalog: SEARCH_INCIDENTS, family: { id: 'quarantined-writes', subjectKind: 'service', resolution: repair('search-outbox-revive'), required: 'always' } },
  { row: 68, catalog: SEARCH_INCIDENTS, family: { id: 'stale-backlog', subjectKind: 'service', resolution: repair('search-engine-restart'), required: 'never' } },
  { row: 70, catalog: SEARCH_CONSISTENCY_INCIDENTS, family: { id: 'migration-parked', subjectKind: 'table', resolution: repair('search-consistency-rebuild'), required: 'always' } },
  { row: 72, catalog: SEARCH_CONSISTENCY_INCIDENTS, family: { id: 'table-unreadable', subjectKind: 'table', resolution: repair('search-consistency-restart'), required: 'always' } },
  { row: 74, catalog: SEARCH_CONSISTENCY_INCIDENTS, family: { id: 'table-missing', subjectKind: 'table', resolution: repair('search-consistency-rebuild'), required: 'always' } },
  { row: 76, catalog: SEARCH_CONSISTENCY_INCIDENTS, family: { id: 'unclaimed-tables', subjectKind: 'service', resolution: repair('search-drop-unclaimed-tables'), required: 'never' } },
  { row: 79, catalog: SEARCH_SPIN_INCIDENTS, family: { id: 'backfill-spin', subjectKind: 'table', resolution: repair('search-spin-rebuild'), required: 'always' } },
  { row: 81, catalog: SEARCH_CANARY_INCIDENTS, family: { id: 'search-dark', subjectKind: 'service', resolution: repair('search-canary-restart'), required: 'always' } },
  { row: 85, catalog: SEARCH_CANARY_INCIDENTS, family: { id: 'engine-watch-state-unknown', subjectKind: 'record', resolution: repair('search-engine-watch-reset'), required: 'never' } },
  { row: 85, catalog: SEARCH_ENGINE_BURN_INCIDENTS, family: { id: 'engine-watch-state-unknown', subjectKind: 'record', resolution: repair('search-engine-watch-reset'), required: 'never' } },
  { row: 86, catalog: SEARCH_ENGINE_BURN_INCIDENTS, family: { id: 'engine-wedged', subjectKind: 'service', resolution: repair('search-engine-burn-restart'), required: 'always' } },
]

/** Observation rows: keys that must NOT be families any more (they carry no incident). */
const OBSERVATION_ROWS: Array<{ row: number; catalog: HealthIncidentDeclaration[]; key: string }> = [
  { row: 52, catalog: SEARCH_INCIDENTS, key: 'search-disabled' },
  { row: 53, catalog: SEARCH_INCIDENTS, key: 'supervision-unknown' },
  { row: 58, catalog: SEARCH_INCIDENTS, key: 'connection-unknown' },
  { row: 59, catalog: SEARCH_INCIDENTS, key: 'text-embedder-disabled' },
  { row: 60, catalog: SEARCH_INCIDENTS, key: 'media-embedder-disabled' },
  { row: 61, catalog: SEARCH_INCIDENTS, key: 'embedder-caps-unknown' },
  { row: 62, catalog: SEARCH_INCIDENTS, key: 'indexes-unavailable' },
  { row: 63, catalog: SEARCH_INCIDENTS, key: 'no-indexes' },
  { row: 65, catalog: SEARCH_INCIDENTS, key: 'table-health' },
  { row: 66, catalog: SEARCH_INCIDENTS, key: 'journal-unknown' },
  { row: 69, catalog: SEARCH_CONSISTENCY_INCIDENTS, key: 'availability-unknown' },
  { row: 71, catalog: SEARCH_CONSISTENCY_INCIDENTS, key: 'migration-running' },
  { row: 73, catalog: SEARCH_CONSISTENCY_INCIDENTS, key: 'table-unknown' },
  { row: 75, catalog: SEARCH_CONSISTENCY_INCIDENTS, key: 'engine-table-sweep-failed' },
  { row: 77, catalog: SEARCH_CONSISTENCY_INCIDENTS, key: 'tombstones-remain' },
  { row: 78, catalog: SEARCH_CONSISTENCY_INCIDENTS, key: 'deep-sweep-failed' },
  { row: 80, catalog: SEARCH_SPIN_INCIDENTS, key: 'spin-status-unknown' },
  { row: 82, catalog: SEARCH_CANARY_INCIDENTS, key: 'search-dark-first-sample' },
  { row: 83, catalog: SEARCH_CANARY_INCIDENTS, key: 'query-degraded' },
  { row: 84, catalog: SEARCH_CANARY_INCIDENTS, key: 'canary-unknown' },
  { row: 87, catalog: SEARCH_ENGINE_BURN_INCIDENTS, key: 'wedge-first-sample' },
  { row: 88, catalog: SEARCH_ENGINE_BURN_INCIDENTS, key: 'sustained-cpu' },
  { row: 89, catalog: SEARCH_ENGINE_BURN_INCIDENTS, key: 'engine-burn-unknown' },
]

const NONE = { deletesUserContent: false, spendsMoney: false, widensAuthorization: false }
/** Every search repair action: the table's effects column → the ONE mode policy's verdict. */
const ACTIONS: Array<{ rows: string; action: HealthRepairActionDefinition; effects: HealthRepairEffects; mode: 'self-heal' | 'one-click'; mutation?: HealthMutationKind }> = [
  { rows: '57/68', action: searchEngineRestartRepair(), effects: { ...NONE, restartsService: 'search-engine', resolves: ['stale-backlog'] }, mode: 'self-heal', mutation: 'restart' },
  { rows: '81', action: searchCanaryRepair(), effects: { ...NONE, restartsService: 'search-engine' }, mode: 'self-heal', mutation: 'restart' },
  { rows: '86', action: searchEngineBurnRepair(), effects: { ...NONE, restartsService: 'search-engine' }, mode: 'self-heal', mutation: 'restart' },
  { rows: '72', action: searchConsistencyRestartRepair(), effects: { ...NONE, restartsService: 'search-engine' }, mode: 'self-heal', mutation: 'restart' },
  { rows: '55/56', action: searchEngineInstallRepair(), effects: { ...NONE, restartsService: 'search-engine' }, mode: 'self-heal', mutation: 'reinstall' },
  { rows: '54', action: searchEngineClaimRepair(), effects: { ...NONE, widensAuthorization: true, restartsService: 'search-engine' }, mode: 'one-click', mutation: 'policy' },
  { rows: '64', action: searchScarRepair(), effects: NONE, mode: 'self-heal', mutation: 'rebuild' },
  { rows: '67', action: searchOutboxRepair(), effects: NONE, mode: 'self-heal' },
  { rows: '70/74', action: searchConsistencyRepair(), effects: NONE, mode: 'self-heal', mutation: 'rebuild' },
  { rows: '76', action: searchDropUnclaimedTablesRepair(), effects: { ...NONE, deletesUserContent: true }, mode: 'one-click', mutation: 'delete' },
  { rows: '79', action: searchSpinRepair(), effects: NONE, mode: 'self-heal', mutation: 'rebuild' },
  { rows: '85', action: searchEngineWatchResetRepair(), effects: NONE, mode: 'self-heal' },
]

function observed(run: Awaited<ReturnType<typeof checkSearchAdapter>>): HealthObservationInput[] {
  const parsed = parseHealthCheckRunInput(run)
  if (parsed.outcome !== 'observed') throw new Error(`expected observations, got ${parsed.outcome}`)
  return parsed.observations
}
const incidentOf = (rows: HealthObservationInput[], key: string) => rows.find((row) => row.status !== 'healthy' && row.incident?.key === key)?.incident

describe('re-homing rows 52–89 — declared families', () => {
  for (const { row, catalog, family } of TABLE) {
    it(`row ${row}: ${family.id} is declared as ${family.resolution.type} (${family.required})`, () => {
      const declared = catalog.find((entry) => entry.id === family.id)
      expect(declared).toEqual(family)
    })
  }
  for (const { row, catalog, key } of OBSERVATION_ROWS) {
    it(`row ${row}: ${key} is an observation, not a family`, () => {
      expect(catalog.some((entry) => entry.id === key)).toBe(false)
    })
  }
  it('no catalog declares a family the table does not have', () => {
    const declared = [SEARCH_INCIDENTS, SEARCH_CONSISTENCY_INCIDENTS, SEARCH_SPIN_INCIDENTS, SEARCH_CANARY_INCIDENTS, SEARCH_ENGINE_BURN_INCIDENTS]
      .flatMap((catalog, index) => catalog.map((entry) => `${index}:${entry.id}`))
    const catalogs = [SEARCH_INCIDENTS, SEARCH_CONSISTENCY_INCIDENTS, SEARCH_SPIN_INCIDENTS, SEARCH_CANARY_INCIDENTS, SEARCH_ENGINE_BURN_INCIDENTS]
    const expected = TABLE.map(({ catalog, family }) => `${catalogs.indexOf(catalog)}:${family.id}`)
    expect(declared.sort()).toEqual([...new Set(expected)].sort())
  })
})

describe('re-homing rows 52–89 — action effects and modes', () => {
  for (const { rows, action, effects, mode, mutation } of ACTIONS) {
    it(`row ${rows}: ${action.id} declares ${JSON.stringify(effects)} → ${mode}`, () => {
      expect(action.effects).toEqual(effects)
      expect(repairMode(action.effects)).toBe(mode)
      expect(action.mutation).toBe(mutation)
    })
  }
})

describe('re-homing rows 52–68 — emitted by the health.search check', () => {
  it('row 52: disabled search is a plain advisory observation (no incident)', async () => {
    searchEnabled = false
    const rows = observed(await checkSearchAdapter())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'engine.enabled', status: 'warning' })
    expect(rows[0]!.incident).toBeUndefined()
  })

  it('row 54: a claimable home gets the one-click claim; a home that cannot claim gets the endpoint decision', async () => {
    serviceStatus = { mode: 'launchd', provisioned: false, refusal: { reason: 'owned-elsewhere', detail: 'Owned by /Users/x/.bakin.', remediation: 'install' } }
    const claim = incidentOf(observed(await checkSearchAdapter()), 'service-ownership')
    expect(claim).toMatchObject({ declarationId: 'service-ownership-claim', subject: { kind: 'service', id: 'search-engine' }, disposition: 'action_required', resolution: { type: 'repair', actionId: 'search-engine-claim' } })

    serviceStatus = { mode: 'launchd', provisioned: false, refusal: { reason: 'temporary-home', detail: 'This temporary home cannot claim the shared service.', remediation: 'configure-endpoint' } }
    const decision = incidentOf(observed(await checkSearchAdapter()), 'service-ownership')
    expect(decision).toMatchObject({ declarationId: 'service-ownership', resolution: { type: 'human', needs: 'decision', href: '/settings?tab=system' } })
    expect(decision?.impact).toContain('search.settings.url')
  })

  it('row 55: a missing binary is the install repair', async () => {
    binaryInstalled = false
    expect(incidentOf(observed(await checkSearchAdapter()), 'binary-missing')).toMatchObject({ declarationId: 'binary-missing', subject: { kind: 'service', id: 'search-engine' }, resolution: { type: 'repair', actionId: 'search-engine-install' } })
  })

  it('row 56: an unprovisioned service is the install repair', async () => {
    serviceStatus = { mode: 'launchd', provisioned: false }
    expect(incidentOf(observed(await checkSearchAdapter()), 'service-unprovisioned')).toMatchObject({ declarationId: 'service-unprovisioned', resolution: { type: 'repair', actionId: 'search-engine-install' } })
  })

  it('row 57: an unreachable engine is the restart repair; a guest endpoint is the operator\'s decision', async () => {
    searchAvailable = false
    expect(incidentOf(observed(await checkSearchAdapter()), 'engine-unavailable')).toMatchObject({ declarationId: 'engine-unavailable', resolution: { type: 'repair', actionId: 'search-engine-restart' } })
    serviceStatus = { mode: 'guest', provisioned: true }
    expect(incidentOf(observed(await checkSearchAdapter()), 'engine-unavailable')).toMatchObject({ declarationId: 'engine-unavailable-guest', resolution: { type: 'human', needs: 'decision', href: '/settings?tab=system' } })
  })

  it('rows 53/58/62: unknowns are plain observations', async () => {
    serviceStatusError = new Error('launchctl exploded')
    const rows = observed(await checkSearchAdapter())
    const supervision = rows.find((row) => row.key === 'engine.supervision')
    expect(supervision).toMatchObject({ status: 'unknown' })
    expect(supervision!.incident).toBeUndefined()
  })

  it('rows 67/68: quarantined writes are the revive repair; a stale backlog folds under the engine, resolved by its restart', async () => {
    outbox = { pending: 3, quarantined: 2, oldestPendingEnqueuedAt: Date.now() - 60 * 60_000 }
    const rows = observed(await checkSearchAdapter())
    expect(incidentOf(rows, 'quarantined-writes')).toMatchObject({ declarationId: 'quarantined-writes', subject: { kind: 'service', id: 'search-engine' }, resolution: { type: 'repair', actionId: 'search-outbox-revive' } })
    expect(incidentOf(rows, 'stale-backlog')).toMatchObject({
      declarationId: 'stale-backlog',
      disposition: 'watch',
      dependsOn: { subject: { kind: 'service', id: 'search-engine' }, resolvedBy: 'search-engine-restart' },
      resolution: { type: 'repair', actionId: 'search-engine-restart' },
    })
  })
})
