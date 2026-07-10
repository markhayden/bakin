/**
 * T7 (#604) — end-to-end abort chain against the Imitation Crab gateway:
 * real dispatch-turns registry → real OpenClaw adapter → mock gateway RPC.
 *
 * Proves the composition: abortTurnsForTask fires the turn's controller, the
 * adapter rejects locally with kind 'aborted' AND lands a chat.abort frame
 * on the gateway (cancelling the mock's pending slow turn), dispatch settles
 * clean (slot freed, task.turn_aborted audited, no recovery ladder) — all
 * within a fraction of the 10s slow-mode delay.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const tempDir = mkdtempSync(join(tmpdir(), 'bakin-abort-e2e-'))
let mockHome = tempDir // re-pointed at the harness home once it exists

const contentDirMock = () => ({
  getContentDir: () => tempDir,
  getBakinPaths: () => ({ root: tempDir, home: tempDir, db: join(tempDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => mockHome,
  getOpenClawPath: (...parts: string[]) => join(mockHome, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => mockHome,
  getOpenClawPath: (...parts: string[]) => join(mockHome, ...parts),
  resetOpenClawHome: () => {},
}))

const settingsValue = {
  dispatch: {
    intervalMs: 1000,
    maxRetries: 3,
    failureCooldownMs: 30 * 60 * 1000,
    transientCooldownMs: 60 * 1000,
    maxDispatched: 5,
    oversizedOutputBytes: 128 * 1024,
    maxConcurrentTurns: 3,
    maxTurnsPerAgent: 1,
  },
  agentPackages: { lessonsRetrieval: { enabled: false } },
}
mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock(() => settingsValue),
}))

const auditEvents: Array<{ event: string; data: Record<string, unknown> }> = []
const appendAuditMock = mock((_dir: string, event: string, _agent: string, data?: Record<string, unknown>) => {
  auditEvents.push({ event, data: data ?? {} })
})
mock.module('../../src/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('@/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('../../src/core/usage', () => ({ recordUsage: mock() }))

const taskStoreMock = {
  // t-e2e must exist on the board — fireDispatchTurn's fire-time existence
  // guard (review F3) aborts turns whose task has vanished.
  readTaskboard: mock(() => ({ columns: { backlog: [], todo: [], inProgress: [{ id: 't-e2e', title: 'E2E doomed task' }], review: [], done: [], archived: [], blocked: [] } })),
  addTaskLog: mock(async () => undefined),
  updateTask: mock(async () => undefined),
  moveTask: mock(async () => undefined),
  blockTask: mock(async () => undefined),
}
mock.module('../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

const hookRegistryMock = () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock(async () => undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
})
mock.module('../../src/core/plugin-registry', hookRegistryMock)
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)

// The harness services (real adapter over the mock gateway) back app-services.
let harnessServices: unknown = null
mock.module('../../src/core/app-services', () => ({ getAppServices: () => harnessServices }))
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => harnessServices }))
mock.module('@/core/app-services', () => ({ getAppServices: () => harnessServices }))
mock.module('@/core/app-services-store', () => ({ getAppServices: () => harnessServices }))

import { createImitationCrabHarness, type ImitationCrabHarness } from '../../dev/imitation-crab/harness'
import { handleGatewayRpcRequest } from '../../dev/imitation-crab/gateway'
import { openClawCliSessionId } from '../../packages/adapter-openclaw/src/session-store'
import { fireDispatchTurn, getInFlightTurnCount, awaitDispatchIdle } from '../../src/core/dispatch-turns'
import { abortTurnsForTask } from '../../src/core/dispatch-registry'
import { closeDb } from '../../packages/core/src/storage/db'

let harness: ImitationCrabHarness | null = null

afterAll(async () => {
  await harness?.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
})

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('delete-mid-turn abort, end to end against the mock gateway', () => {
  it('aborts a slow in-flight turn: local settle, chat.abort landed, slot freed, audited', async () => {
    process.env.OPENCLAW_MOCK_CHAT_DELAY_MS = '10000'
    harness = await createImitationCrabHarness({ chatMode: 'slow' })
    harnessServices = harness.services
    mockHome = harness.env.home

    const threadId = 'task:t-e2e:d1'
    fireDispatchTurn({
      marker: 't-e2e',
      task: { id: 't-e2e', title: 'E2E doomed task' } as never,
      targetAgent: 'main',
      threadId,
      message: 'work on the doomed task',
      contentDir: tempDir,
      port: 3737,
      initialLogCount: 0,
      logPrefix: 'e2e',
      dispatchKind: 'regular',
    })

    // Let the send reach the gateway (the mock's slow sleep is now pending).
    await tick(150)
    expect(getInFlightTurnCount('main')).toBe(1)

    const abortStart = Date.now()
    expect(abortTurnsForTask('t-e2e', 'task-deleted')).toBe(1)
    await awaitDispatchIdle()
    const settleMs = Date.now() - abortStart

    // Settled from the abort, not the 10s slow delay.
    expect(settleMs).toBeLessThan(2000)
    expect(getInFlightTurnCount()).toBe(0)

    const abortAudits = auditEvents.filter((e) => e.event === 'task.turn_aborted')
    expect(abortAudits.length).toBe(1)
    expect(abortAudits[0].data).toMatchObject({ id: 't-e2e', runId: threadId, reason: 'task-deleted' })
    // Clean exit — nothing entered failure classification or the ladder.
    expect(auditEvents.filter((e) => e.event === 'task.turn_force_released').length).toBe(0)

    // The adapter's chat.abort frame consumed the mock's pending slow turn:
    // a follow-up abort for the same session finds nothing left to cancel.
    await tick(50)
    const sessionKey = `agent:main:explicit:${openClawCliSessionId('main', threadId)}`
    const probe = await handleGatewayRpcRequest('chat.abort', { sessionKey })
    expect(probe.ok).toBe(true)
    expect((probe.payload as { aborted: boolean }).aborted).toBe(false)
  }, 15_000)
})
