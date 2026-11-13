/**
 * Search reset and reindex as operations (#895 D15): plans, outcomes, the
 * synchronous refusals, and waiting visibly for whoever holds the engine.
 * The adapter setup and the rebuild pass are fakes; the operation registry,
 * its resource locks and the stage/item reporting are real.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { OperationContext } from '@makinbakin/sdk/types'

const testDir = join(tmpdir(), `bakin-test-search-operations-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const paths = () => ({ home: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

let searchEnabled = true
let supportsReset = true
let resetStatus: 'installed' | 'failed' = 'installed'
let tablesOutcome: Array<{ table: string; result: string; indexed?: number; error?: string }> = []
const resetCalls: string[] = []
let supportsUninstall = true
let uninstallStatus: 'installed' | 'noop' | 'failed' = 'installed'
const uninstallCalls: Array<{ removeData: boolean; removeEngine: boolean }> = []
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ search: { adapter: 'fake', settings: { enabled: searchEnabled } } }),
}))
mock.module('../../src/core/search-adapter-factory', () => ({
  getSearchAdapterSetup: () => ({
    ...(supportsReset ? {
      resetEngineData: async (op: OperationContext) => {
        for (const stage of ['stop', 'wipe', 'boot']) {
          op.stage(stage)
          resetCalls.push(stage)
        }
        return { name: 'reset', status: resetStatus, message: resetStatus === 'installed' ? 'Engine reset clean and responding.' : 'Engine reset failed: unit refused to stop', durationMs: 1 }
      },
    } : {}),
    ...(supportsUninstall ? {
      uninstall: async (opts: { op: OperationContext; removeData: boolean; removeEngine: boolean }) => {
        uninstallCalls.push({ removeData: opts.removeData, removeEngine: opts.removeEngine })
        opts.op.stage('stop')
        opts.op.stage('service')
        opts.op.skip('data', 'kept')
        opts.op.skip('engine', 'kept')
        return { name: 'uninstall', status: uninstallStatus, message: uninstallStatus === 'failed' ? 'Search service belongs to /other, not /here.' : 'Stopped the service and removed its registration.', durationMs: 1 }
      },
    } : {}),
  }),
}))
const rebuild = mock(async (_table: string | undefined, _opts: unknown, report?: { op: OperationContext; stageId: string }) => {
  for (const t of tablesOutcome) report?.op.item(report.stageId, { id: t.table, label: t.table, status: t.error || t.result === 'parked' ? 'failed' : 'done' })
  return tablesOutcome
})
mock.module('../../src/core/search-registry', () => ({ rebuildRegisteredTables: rebuild }))

import { createOperationRegistry, holdNow, OperationRejectedError } from '@bakin/core/operations'
import { REINDEX_PLAN, SEARCH_RESET_PLAN, SEARCH_UNINSTALL_PLAN, reindexOperation, searchResetOperation, searchUninstallOperation, type SearchResetResult } from '../../src/core/search-operations'
import { waitUntil } from '../helpers/wait'

let registry: ReturnType<typeof createOperationRegistry>
beforeEach(() => {
  searchEnabled = true
  supportsReset = true
  resetStatus = 'installed'
  tablesOutcome = [{ table: 'bakin_tasks', result: 'migrated', indexed: 3 }, { table: 'bakin_assets', result: 'unchanged', indexed: 2 }]
  resetCalls.length = 0
  supportsUninstall = true
  uninstallStatus = 'installed'
  uninstallCalls.length = 0
  rebuild.mockClear()
  registry = createOperationRegistry({ bootId: () => 'b', publish: () => {}, quietCheckIntervalMs: 0 })
})
afterEach(() => registry.dispose())
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

async function settle(input: ReturnType<typeof searchResetOperation> | ReturnType<typeof reindexOperation>) {
  const { operationId } = await registry.start(input as never)
  return registry.await(operationId)
}

describe('plans', () => {
  it('neither is cancellable, and reset is stop → wipe → boot → reindex', () => {
    expect(REINDEX_PLAN.pointOfNoReturn).toBe('start')
    expect(SEARCH_RESET_PLAN.pointOfNoReturn).toBe('start')
    expect(SEARCH_RESET_PLAN.stages.map((stage) => stage.id)).toEqual(['stop', 'wipe', 'boot', 'reindex'])
  })

  it('the rebuild stage is not called stuck while a long table backfills', () => {
    expect(REINDEX_PLAN.stages[0]!.quiet).toEqual({ quietMs: 60_000, stuckMs: 600_000 })
  })
})

describe('search reset', () => {
  it('runs every stage and reports the rebuild it ran', async () => {
    const view = await settle(searchResetOperation('cli'))
    expect(view.status).toBe('succeeded')
    expect(view.stages.map((stage) => [stage.id, stage.status])).toEqual([['stop', 'done'], ['wipe', 'done'], ['boot', 'done'], ['reindex', 'done']])
    expect(view.stages[3]!.items!.map((item) => item.id)).toEqual(['bakin_tasks', 'bakin_assets'])
    expect(view.result!.body).toEqual({
      ok: true,
      message: 'Engine reset clean and responding.',
      reindex: { ok: true, errors: 0, parked: 0, total: 5, tables: tablesOutcome },
    } satisfies SearchResetResult)
    expect(rebuild).toHaveBeenCalledWith(undefined, { force: false }, expect.objectContaining({ stageId: 'reindex' }))
  })

  it('a failed engine reset ends reset_failed and never reindexes', async () => {
    resetStatus = 'failed'
    const view = await settle(searchResetOperation('web'))
    expect(view.status).toBe('failed')
    expect(view.outcome?.code).toBe('reset_failed')
    expect(view.result!.body).toEqual({ ok: false, message: 'Engine reset failed: unit refused to stop', reindex: null })
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('a rebuild that leaves tables parked ends reset_failed (D22), keeping the rows', async () => {
    tablesOutcome = [{ table: 'bakin_tasks', result: 'parked', indexed: 0 }]
    const view = await settle(searchResetOperation('web'))
    expect(view.status).toBe('failed')
    expect(view.outcome?.code).toBe('reset_failed')
    expect((view.result!.body as SearchResetResult).reindex).toMatchObject({ ok: false, parked: 1, tables: tablesOutcome })
  })

  it('refuses synchronously (409, nothing starts) when search is disabled or the adapter cannot reset', async () => {
    searchEnabled = false
    const disabled = await registry.start(searchResetOperation('web')).catch((err: unknown) => err)
    expect(disabled).toBeInstanceOf(OperationRejectedError)
    expect((disabled as OperationRejectedError).httpStatus).toBe(409)
    expect((disabled as OperationRejectedError).body).toEqual({ ok: false, message: 'Search is disabled in settings — enable it before resetting.', reindex: null })

    searchEnabled = true
    supportsReset = false
    const unsupported = await registry.start(searchResetOperation('web')).catch((err: unknown) => err)
    expect((unsupported as OperationRejectedError).body).toMatchObject({ message: "The 'fake' search adapter does not support engine reset." })
    expect(resetCalls).toEqual([])
    expect(registry.list()).toEqual([])
  })

  it('waits visibly for an in-flight background migration pass before stopping the engine', async () => {
    let release!: () => void
    const held = holdNow(['search-engine'], { title: 'Background index migration' }, () => new Promise<void>((resolve) => { release = resolve }))
    const { operationId } = await registry.start(searchResetOperation('web'))
    await waitUntil(() => registry.get(operationId)?.waitingFor !== undefined, { label: 'the reset waits for search-engine' })
    expect(registry.get(operationId)!.waitingFor!.holderTitle).toBe('Background index migration')
    expect(resetCalls).toEqual([])

    release()
    await held
    expect((await registry.await(operationId)).status).toBe('succeeded')
    expect(resetCalls).toEqual(['stop', 'wipe', 'boot'])
  })

  it('a reset queued behind a holder rechecks its preconditions before touching the engine (D7)', async () => {
    let release!: () => void
    const held = holdNow(['search-engine'], { title: 'Background index migration' }, () => new Promise<void>((resolve) => { release = resolve }))
    const { operationId } = await registry.start(searchResetOperation('web'))
    await waitUntil(() => registry.get(operationId)?.waitingFor !== undefined, { label: 'the reset waits for search-engine' })
    searchEnabled = false

    release()
    await held
    const view = await registry.await(operationId)
    expect(view.status).toBe('failed')
    expect(view.outcome?.code).toBe('reset_failed')
    expect(view.result!.body).toEqual({ ok: false, message: 'Search is disabled in settings — enable it before resetting.', reindex: null })
    expect(resetCalls).toEqual([])
    expect(rebuild).not.toHaveBeenCalled()
  })
})

describe('reindex', () => {
  it('converged tables succeed with the report as the result', async () => {
    const view = await settle(reindexOperation({ table: 'bakin_tasks', force: true, origin: 'system' }))
    expect(view.status).toBe('succeeded')
    expect(view.fingerprint).toBe('search:reindex:bakin_tasks:force')
    expect(view.result!.body).toEqual({ ok: true, errors: 0, parked: 0, total: 5, tables: tablesOutcome })
    expect(rebuild).toHaveBeenCalledWith('bakin_tasks', { force: true }, expect.objectContaining({ stageId: 'reindex' }))
  })

  it('a failed table ends tables_parked with the rows kept', async () => {
    tablesOutcome = [{ table: 'bakin_tasks', result: 'failed', error: 'engine lost' }, { table: 'bakin_assets', result: 'unchanged', indexed: 2 }]
    const view = await settle(reindexOperation({ origin: 'web' }))
    expect(view.status).toBe('failed')
    expect(view.outcome).toMatchObject({ code: 'tables_parked' })
    expect(view.result).toEqual({ httpStatus: 200, body: { ok: false, errors: 1, parked: 0, total: 2, tables: tablesOutcome } })
  })
})

describe('search uninstall as an operation (#1049)', () => {
  const start = (input: { removeData?: boolean; removeEngine?: boolean } = {}) =>
    registry.start(searchUninstallOperation({ origin: 'cli', removeData: input.removeData === true, removeEngine: input.removeEngine === true }))

  it('declares the four stages, owns search-engine, and passes what was asked to the adapter', async () => {
    expect(SEARCH_UNINSTALL_PLAN.stages.map((stage) => stage.id)).toEqual(['stop', 'service', 'data', 'engine'])
    const input = searchUninstallOperation({ origin: 'cli', removeData: true, removeEngine: false })
    expect(input.resources).toEqual(['search-engine'])
    const view = await registry.await((await start({ removeData: true })).operationId)
    expect(view.status).toBe('succeeded')
    expect(view.result?.body).toEqual({ ok: true, message: 'Stopped the service and removed its registration.' })
    expect(uninstallCalls).toEqual([{ removeData: true, removeEngine: false }])
  })

  it('an adapter refusal is a failed operation in the adapter\'s own words', async () => {
    uninstallStatus = 'failed'
    const view = await registry.await((await start()).operationId)
    expect(view.status).toBe('failed')
    expect(view.outcome).toMatchObject({ code: 'uninstall_failed', message: 'Search service belongs to /other, not /here.' })
  })

  it('nothing to remove is a success that says so, never a failure', async () => {
    uninstallStatus = 'noop'
    const view = await registry.await((await start()).operationId)
    expect(view.status).toBe('succeeded')
  })

  it('an adapter that installs nothing is refused before anything starts', async () => {
    supportsUninstall = false
    const refused = await start().catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(OperationRejectedError)
    expect((refused as OperationRejectedError).body).toEqual({ ok: false, message: "The 'fake' search adapter installs nothing on this machine." })
    expect(uninstallCalls).toEqual([])
  })

  it('waits for whoever holds the engine instead of pulling it out from under them', async () => {
    let release!: () => void
    const held = holdNow(['search-engine'], { title: 'Reindex search' }, () => new Promise<void>((resolve) => { release = resolve }))
    const { operationId } = await start()
    await waitUntil(() => registry.get(operationId)?.waitingFor !== undefined, { label: 'the uninstall is waiting on the holder' })
    expect(registry.get(operationId)!.waitingFor!.holderTitle).toBe('Reindex search')
    expect(uninstallCalls).toEqual([])
    release()
    await held
    expect((await registry.await(operationId)).status).toBe('succeeded')
  })
})
