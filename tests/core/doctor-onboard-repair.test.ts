/**
 * `core.onboard` (self-healing PR1 slice 1.3c, re-homing row 205): the
 * onboarding gate's one-click repair runs what `bakin onboard --yes` runs,
 * each component as its own operation, and reports per component.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-onboard-repair-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

import { onboardRepair, type OnboardRepairDeps } from '../../src/core/doctor-onboard-repair'
import { noopOp } from '../helpers/operation-harness'
import { expectRepairContract, runRepairContract, stampPlanItems } from '../helpers/repair-contract'

const target = { type: 'all_actionable' as const, reportId: 'r' }
const ran: string[] = []
let markerWritten = true
const deps = (): OnboardRepairDeps => ({
  runOnboard: async (opts, installComponent) => {
    expect(opts).toMatchObject({ autoApprove: true, checkOnly: false, json: false, force: false })
    const results = []
    for (const name of ['mkdir', 'settings', 'search']) {
      results.push(await installComponent({ name } as never, { autoApprove: true } as never))
    }
    opts.onOutcome?.({ name: 'search', finalStatus: 'ok', message: 'engine ready' })
    return { outcomes: results.map((r) => ({ name: r.name, finalStatus: r.status === 'failed' ? 'error' : 'ok', message: r.message })) as never, exitCode: markerWritten ? 0 : 1, markerWritten }
  },
  runComponent: async (name) => { ran.push(name); return name === 'search' && !markerWritten ? { name, status: 'failed', message: 'download failed', durationMs: 1 } : { name, status: 'installed', message: `${name} ok`, durationMs: 1 } },
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }); ran.length = 0; markerWritten = true })

describe('core.onboard', () => {
  it('plans ONE one-click item (first-run choices widen what the operator authorized — row 205) and owns no resources of its own — each component is its own operation', async () => {
    const action = onboardRepair(deps())
    expect(action.id).toBe('onboard')
    expect(action.resources ?? []).toEqual([])
    expect(action.effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: true })
    const plan = stampPlanItems(action, await action.plan(target))
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ actionId: 'onboard', mode: 'one-click', effects: { widensAuthorization: true } })
    expect(plan[0]!.changes[0]!.description).toMatch(/bakin onboard --yes/)
  })
  it('apply runs every component through the installer, reports each as an item and applies once the marker is written', async () => {
    const action = onboardRepair(deps())
    const run = await runRepairContract(action, stampPlanItems(action, await action.plan(target)))
    expectRepairContract(action, run)
    expect(ran).toEqual(['mkdir', 'settings', 'search'])
    expect(run.calls).toContain('item:components:search')
    expect(run.results[0]).toMatchObject({ status: 'applied', affectedCheckIds: ['core.onboarded'] })
  })
  it('a component failure leaves the gate closed: failed, naming the component', async () => {
    markerWritten = false
    const action = onboardRepair(deps())
    const [result] = await action.apply(stampPlanItems(action, await action.plan(target)), noopOp())
    expect(result).toMatchObject({ status: 'failed' })
    expect(result!.message).toContain('search')
  })
})
