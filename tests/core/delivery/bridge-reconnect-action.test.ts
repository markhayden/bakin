/**
 * Self-healing PR1 slice 1.3c: `discord-bridge-reconnect` — the bridge's own
 * operator reconcile as a Health repair (re-homing rows 24–25), and the
 * reconnect helper the API route and the repair share.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-bridge-reconnect-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import type { ChannelReadiness } from '../../../packages/core/src/delivery'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

const readiness = (state: ChannelReadiness['connection']['state'], lastError: ChannelReadiness['connection']['lastError'] = null): ChannelReadiness => ({
  runtime: { adapter: 'pi', deliveryMode: 'unavailable' }, owner: 'bridge', enabled: true,
  token: { present: true, source: 'store' }, guilds: [{ id: 'g1', joined: state === 'connected', channelCount: state === 'connected' ? 1 : null }],
  connection: { state, since: 'x', lastError }, channels: { items: [], source: 'none', collectedAt: null },
  routing: { alertChannel: { setting: 'notifications.channel', value: null, resolved: 'unset' }, approvalsChannel: { setting: 'approvals.channel', value: null, resolved: 'unset' }, approvalsEnabled: false, aliases: [] },
  remediation: null, generatedAt: 'x',
})

let reconnects: Array<{ waitMs?: number }> = []
let reconnectOutcome: { outcome: 'settled' | 'timeout' | 'owner_is_runtime'; readiness: ChannelReadiness } = { outcome: 'settled', readiness: readiness('connected') }
mock.module('../../../src/core/delivery/readiness', () => ({
  getChannelReadiness: () => reconnectOutcome.readiness,
  subscribeChannelReadiness: () => () => {},
  CHANNEL_HEALTH_CHECK_IDS: ['health.delivery-discord', 'health.channel-aliases', 'health.channel-approvals'],
  reconnectDeliveryBridge: async (opts: { waitMs?: number }) => { reconnects.push(opts); return reconnectOutcome },
}))

import { discordBridgeReconnectRepair } from '../../../plugins/health/lib/system-checks/delivery-discord'
import { noopOp } from '../../helpers/operation-harness'
import { expectRepairContract, runRepairContract } from '../../helpers/repair-contract'

const target = { type: 'all_actionable' as const, reportId: 'r' }

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }); reconnects = []; reconnectOutcome = { outcome: 'settled', readiness: readiness('connected') } })

describe('discord-bridge-reconnect', () => {
  it('plans a safe reconnect and applies through the ONE reconnect helper, reporting applied once the bridge delivers again', async () => {
    const action = discordBridgeReconnectRepair()
    const plan = await action.plan(target)
    expect(plan[0]).toMatchObject({ actionId: 'discord-bridge-reconnect', safety: 'safe' })
    const run = await runRepairContract(action, plan)
    expectRepairContract(action, run)
    expect(reconnects).toHaveLength(1)
    expect(run.results[0]).toMatchObject({ status: 'applied', affectedCheckIds: ['health.delivery-discord', 'health.channel-aliases', 'health.channel-approvals'] })
  })
  it('a bridge that still is not delivering after the wait is a failure naming the last error; a native runtime is refused plainly', async () => {
    reconnectOutcome = { outcome: 'timeout', readiness: readiness('failed', { kind: 'transport', message: 'ECONNRESET', at: 'x' }) }
    const action = discordBridgeReconnectRepair()
    const [result] = await action.apply(await action.plan(target), noopOp())
    expect(result).toMatchObject({ status: 'failed' })
    expect(result!.message).toContain('ECONNRESET')
    reconnectOutcome = { outcome: 'owner_is_runtime', readiness: readiness('native') }
    const [native] = await action.apply(await action.plan(target), noopOp())
    expect(native).toMatchObject({ status: 'skipped' })
    expect(native!.message).toMatch(/natively/)
  })
})
