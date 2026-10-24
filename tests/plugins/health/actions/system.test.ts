/**
 * Self-healing PR1 slice 1.3c (core + adapters half): `health-acks-reset`,
 * `health-acks-prune`, `runtime-restart`, `session-store-prune` and
 * `service-setup`, and the incidents repointed at them under the old
 * contract (re-homing rows 1–2, 8–11, 12, 14).
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-system-actions-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, logs: join(testDir, 'logs'), db: join(testDir, 'bakin.db') }) })
mock.module('../../../../src/core/content-dir', contentDirMock)
mock.module('../../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../../src/core/logger', loggerMock)
mock.module('../../../../packages/core/src/logger', loggerMock)

// The ONE service-setup engine, faked: records how the repair asked for it.
const setups: Array<{ restart: boolean; uninstall?: boolean }> = []
let setupResult = { ok: true, platform: 'darwin', service: 'com.makinbakin.bakin', unitPath: '/u/p.plist', written: true, loaded: 'started' as 'started' | 'kept' | 'deferred' | 'restarted' | 'removed' | 'not-loaded', message: 'Bakin service installed and started.' }
mock.module('../../../../src/core/service-setup', () => ({
  realServiceSetupIo: async () => ({}),
  setupBakinService: async (opts: { restart: boolean; uninstall?: boolean }) => { setups.push(opts); return setupResult },
}))
// The service check reads settings + the plist; keep it on a fake darwin home.
mock.module('../../../../src/core/settings', () => ({ getSettings: () => ({ service: { enabled: true } }) }))

import type { HealthRepairTarget } from '@makinbakin/sdk'
import type { RuntimeSessionStoreStats } from '@bakin/core/adapters/runtime'
import { noopOp } from '../../../helpers/operation-harness'
import { expectRepairContract, runRepairContract, stampPlanItems } from '../../../helpers/repair-contract'
import { parseHealthCheckRunInput } from '../../../../src/core/health-contract'
import { checkHealthAcks, healthAcksPruneRepair, healthAcksResetRepair } from '../../../../plugins/health/lib/system-checks/health-acks'
import { checkRuntime, runtimeRestartRepair } from '../../../../plugins/health/lib/system-checks/runtime'
import { checkSessionStore, sessionStorePruneRepair, SESSION_STORE_ERROR_BYTES } from '../../../../plugins/health/lib/system-checks/session-store'
import { checkService, serviceSetupRepair } from '../../../../plugins/health/lib/system-checks/service'

const all: HealthRepairTarget = { type: 'all_actionable', reportId: 'r' }
async function observed(run: Promise<unknown>) {
  const parsed = parseHealthCheckRunInput(await run as never)
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true }); mkdirSync(join(testDir, 'health'), { recursive: true })
  setups.length = 0
  setupResult = { ...setupResult, loaded: 'started', message: 'Bakin service installed and started.' }
})

describe('health acks (rows 1–2)', () => {
  const acksPath = join(testDir, 'health', 'acks.json')
  const NOW = Date.parse('2026-10-23T12:00:00.000Z')
  const ack = (incidentId: string, over: Record<string, unknown> = {}) => ({ incidentId, mode: 'ack', at: new Date(NOW - 60_000).toISOString(), tierAtAck: 'watch', resourceFingerprint: 'agent:relay', ...over })

  it('an unreadable store points at health-acks-reset, which moves the file aside (never deletes) and starts empty', async () => {
    writeFileSync(acksPath, '{ nope')
    const [row] = await observed(checkHealthAcks(NOW))
    expect(row!.incident).toMatchObject({ key: 'store-unreadable', resolution: { type: 'repair', actionId: 'health-acks-reset' } })
    const action = healthAcksResetRepair()
    const plan = await action.plan(all)
    expect(action.effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false })
    expect(plan[0]).toMatchObject({ actionId: 'health-acks-reset' })
    const run = await runRepairContract(action, stampPlanItems(action, plan))
    expectRepairContract(action, run)
    expect(run.results[0]).toMatchObject({ status: 'applied', affectedCheckIds: ['health.acks'] })
    expect(existsSync(acksPath)).toBe(false)
    const aside = readdirSync(join(testDir, 'health')).filter((name) => name.startsWith('acks.json.rejected-'))
    expect(aside).toHaveLength(1)
    expect(readFileSync(join(testDir, 'health', aside[0]!), 'utf-8')).toBe('{ nope')
    expect((await observed(checkHealthAcks(NOW)))[0]!.status).toBe('healthy')
  })

  it('invalid records point at health-acks-prune, which removes exactly them and keeps the valid ones', async () => {
    writeFileSync(acksPath, JSON.stringify({ good: ack('good'), forged: ack('forged', { tierAtAck: 'action_required' }), future: ack('future', { at: '2099-01-01T00:00:00.000Z' }) }))
    const [row] = await observed(checkHealthAcks(NOW))
    expect(row!.incident).toMatchObject({ key: 'invalid-records', resolution: { type: 'repair', actionId: 'health-acks-prune' } })
    const action = healthAcksPruneRepair()
    const plan = await action.plan(all)
    expect(plan[0]).toMatchObject({ actionId: 'health-acks-prune' })
    expect(plan[0]!.changes.map((c) => c.target).sort()).toEqual(['acks:forged', 'acks:future'])
    const [result] = await action.apply(stampPlanItems(action, plan), noopOp())
    expect(result).toMatchObject({ status: 'applied' })
    expect(Object.keys(JSON.parse(readFileSync(acksPath, 'utf-8')) as object)).toEqual(['good'])
    expect((await observed(checkHealthAcks(NOW)))[0]!.status).toBe('healthy')
  })

  it('both plan nothing when the store is fine', async () => {
    expect(await healthAcksResetRepair().plan(all)).toEqual([])
    expect(await healthAcksPruneRepair().plan(all)).toEqual([])
  })
})

describe('runtime-restart (row 12)', () => {
  const runtime = (pings: boolean[]) => {
    let restarts = 0
    const queue = [...pings]
    return {
      restarts: () => restarts,
      restart: async () => { restarts++ },
      ping: async () => (queue.length > 1 ? queue.shift()! : queue[0]!),
    }
  }
  it('an unreachable runtime points at runtime-restart; apply restarts and verifies with a ping', async () => {
    const rt = runtime([false, true])
    const [row] = await observed(checkRuntime(rt))
    expect(row!.incident).toMatchObject({ key: 'unreachable', resolution: { type: 'repair', actionId: 'runtime-restart' } })
    const action = runtimeRestartRepair(rt, { pollMs: 1, timeoutMs: 50 })
    const plan = await action.plan(all)
    expect(action.effects).toMatchObject({ restartsService: 'runtime' })
    expect(action.mutation).toBe('restart')
    expect(plan[0]).toMatchObject({ actionId: 'runtime-restart' })
    const run = await runRepairContract(action, stampPlanItems(action, plan))
    expectRepairContract(action, run)
    expect(rt.restarts()).toBe(1)
    expect(run.results[0]).toMatchObject({ status: 'applied', affectedCheckIds: ['health.runtime'] })
  })
  it('a runtime that stays dark after the restart is a failure that says so (core.diagnose takes it from here in PR5)', async () => {
    const rt = runtime([false])
    const action = runtimeRestartRepair(rt, { pollMs: 1, timeoutMs: 20 })
    const [result] = await action.apply(stampPlanItems(action, await action.plan(all)), noopOp())
    expect(result).toMatchObject({ status: 'failed' })
    expect(result!.message).toMatch(/still cannot serve turns/)
  })
})

describe('session-store-prune (row 14)', () => {
  const stats = (agentId: string, diskBytes: number): RuntimeSessionStoreStats => ({ agentId, storeEntries: 10, fileCount: 400, diskBytes, remediation: 'adapter says' })
  const pruned: Array<{ agentId: string; opts?: unknown }> = []
  const runtimeWith = (rows: RuntimeSessionStoreStats[], withPrune = true) => ({
    sessions: {
      list: async () => [], get: async () => null,
      storeStats: async () => rows,
      ...(withPrune ? { pruneStore: async (agentId: string, opts?: unknown) => { pruned.push({ agentId, opts }); return { agentId, removedFiles: 3, freedBytes: 2_000_000, skippedInFlight: 0, remainingFiles: 1 } } } : {}),
    },
  })
  beforeEach(() => { pruned.length = 0 })

  it('an oversized store points at session-store-prune (row 14); a runtime that cannot prune keeps the adapter text in the impact copy', async () => {
    const [row] = await observed(checkSessionStore(runtimeWith([stats('main', SESSION_STORE_ERROR_BYTES + 1)])))
    expect(row!.incident).toMatchObject({ key: 'oversized:main', declarationId: 'oversized', subject: { kind: 'agent', id: 'main' }, resolution: { type: 'repair', actionId: 'session-store-prune' } })
    const [text] = await observed(checkSessionStore(runtimeWith([stats('main', SESSION_STORE_ERROR_BYTES + 1)], false)))
    expect(text!.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'session-store-prune' })
    expect(text!.incident?.impact).toContain('adapter says')
  })
  it('plans one one-click item per oversized agent (it deletes transcripts), applies through the adapter and names what it freed', async () => {
    const rt = runtimeWith([stats('main', SESSION_STORE_ERROR_BYTES + 1), stats('relay', SESSION_STORE_ERROR_BYTES + 1), stats('fine', 10)])
    const action = sessionStorePruneRepair(rt)
    expect(action.effects).toMatchObject({ deletesUserContent: true })
    expect(action.mutation).toBe('delete')
    const plan = await action.plan(all)
    expect(plan.map((item) => item.id)).toEqual(['main', 'relay'])
    expect(plan[0]!.changes[0]).toMatchObject({ kind: 'file', action: 'delete' })
    const one = await action.plan({ type: 'incidents', reportId: 'r', ids: ['health.session-store:oversized:relay'] })
    expect(one.map((item) => item.id)).toEqual(['relay'])
    const run = await runRepairContract(action, stampPlanItems(action, one))
    expectRepairContract(action, run)
    expect(pruned.map((p) => p.agentId)).toEqual(['relay'])
    expect(run.results[0]).toMatchObject({ itemId: 'relay', status: 'applied', affectedCheckIds: ['health.session-store'] })
    expect(run.results[0]!.message).toMatch(/3 .*files/)
  })
  it('plans nothing without a prune-capable runtime', async () => {
    expect(await sessionStorePruneRepair(runtimeWith([stats('main', SESSION_STORE_ERROR_BYTES + 1)], false)).plan(all)).toEqual([])
  })
})

describe('service-setup (rows 8, 9, 11)', () => {
  it('service incidents point at service-setup', async () => {
    if (process.platform !== 'darwin') return
    const rows = await observed(checkService('/some/project'))
    expect(rows[0]!.incident).toMatchObject({ key: 'plist-missing', resolution: { type: 'repair', actionId: 'service-setup' } })
  })
  it('plans a self-heal item (R=bakin — the coordinator schedules it) and applies through the ONE engine WITHOUT a restart', async () => {
    const action = serviceSetupRepair()
    expect(action.effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false, restartsService: 'bakin' })
    expect(action.mutation).toBe('restart')
    const plan = await action.plan(all)
    expect(plan[0]).toMatchObject({ actionId: 'service-setup' })
    expect(plan[0]!.changes[0]).toMatchObject({ kind: 'service', target: 'com.makinbakin.bakin' })
    const run = await runRepairContract(action, stampPlanItems(action, plan))
    expectRepairContract(action, run)
    expect(setups).toEqual([{ restart: false }])
    expect(run.results[0]).toMatchObject({ status: 'applied', affectedCheckIds: ['health.service'] })
  })
  it('a deferred load (a server runs outside the service) is reported as skipped with the engine message; a refused platform fails', async () => {
    setupResult = { ...setupResult, loaded: 'deferred', message: 'Bakin is running outside the managed service (pid 777).' }
    const action = serviceSetupRepair()
    const [deferred] = await action.apply(stampPlanItems(action, await action.plan(all)), noopOp())
    expect(deferred).toMatchObject({ status: 'skipped' })
    expect(deferred!.message).toContain('pid 777')
    setupResult = { ...setupResult, ok: false, loaded: 'not-loaded', message: 'Service management is not supported on win32.' }
    const [failed] = await action.apply(stampPlanItems(action, await action.plan(all)), noopOp())
    expect(failed).toMatchObject({ status: 'failed' })
  })
})
