/**
 * #852 — a model_not_supported dispatch failure is DETERMINISTIC (the
 * account cannot call the routed model): reconcileRejectedDispatch blocks
 * the task immediately with routing remediation, mirroring the
 * BoundRepoError branch, instead of grinding retry cooldowns for 10 days.
 */
import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-modelrej-block-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const blocked: Array<{ id: string; reason: string }> = []
const moved: unknown[] = []
mock.module('../../src/core/task-store', () => ({
  blockTask: async (id: string, reason: string) => { blocked.push({ id, reason }) },
  moveTask: async (...args: unknown[]) => { moved.push(args) },
}))

const logs: Array<{ id: string; message: string; extra?: Record<string, unknown> }> = []
mock.module('../../src/core/dispatch-board', () => ({
  findDispatchTaskSnapshot: () => ({ column: 'inProgress', task: { logs: [] } }),
  taskAlreadyLeftActiveWork: () => false,
  shouldBlockAfterDispatchFailure: () => false,
  tryAddTaskLog: async (id: string, _channel: string, message: string, extra?: Record<string, unknown>) => {
    logs.push({ id, message, ...(extra ? { extra } : {}) })
  },
}))

const audits: Array<{ event: string; agent: string; data: Record<string, unknown> }> = []
mock.module('../../src/core/audit', () => ({
  appendAudit: (_dir: string, event: string, agent: string, data: Record<string, unknown> = {}) => {
    audits.push({ event, agent, data })
  },
}))

import { RuntimeError } from '../../packages/core/src/adapters/runtime'
import { reconcileRejectedDispatch } from '../../src/core/dispatch-session-death'
import type { DispatchState, DispatchTask } from '../../src/core/dispatch-types'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  blocked.length = 0
  moved.length = 0
  logs.length = 0
  audits.length = 0
})

const task = { id: 't-852', title: 'branded render' } as DispatchTask

function baseState(): DispatchState {
  return { dispatched: [], failedDispatches: { 't-852': { lastAttempt: 1, count: 2, kind: 'structural' } } } as unknown as DispatchState
}

describe('reconcileRejectedDispatch — model_not_supported (#852)', () => {
  test('blocks immediately with routing remediation, clears the retry record, audits with the model', async () => {
    const state = baseState()
    await reconcileRejectedDispatch({
      contentDir: testDir,
      port: 3737,
      state,
      dispatchedSet: null,
      task,
      targetAgent: 'pixel',
      err: new RuntimeError("The 'gpt-5.4-mini' model is not supported", {
        kind: 'model_not_supported',
        providerInfo: { provider: 'openai-codex', model: 'openai-codex/gpt-5.4-mini' },
      }),
      dispatchKind: 'task',
      initialLogCount: 0,
      logPrefix: 'Dispatch failed',
    } as never)

    // Blocked once, with the model named and the routing remediation.
    expect(blocked).toHaveLength(1)
    expect(blocked[0]!.reason).toContain('openai-codex/gpt-5.4-mini')
    expect(blocked[0]!.reason).toContain('routing')
    // The retry record is GONE — no cooldown grind for a deterministic failure.
    expect(state.failedDispatches?.['t-852']).toBeUndefined()
    // Audited with structured facts, not just prose.
    const audit = audits.find((a) => a.event === 'task.model_not_supported_blocked')!
    expect(audit.agent).toBe('pixel')
    expect(audit.data.model).toBe('openai-codex/gpt-5.4-mini')
    // Task log carries the structured dispatch failure for the drawer.
    expect(logs[0]!.extra?.dispatchFailure).toMatchObject({ reasonCode: 'model_not_supported', retryable: false })
  })

  test('other structural failures still take the generic retry path (no block)', async () => {
    const state = baseState()
    await reconcileRejectedDispatch({
      contentDir: testDir,
      port: 3737,
      state,
      dispatchedSet: null,
      task,
      targetAgent: 'pixel',
      err: new RuntimeError('adapter exploded', { kind: 'runtime_failed' }),
      dispatchKind: 'task',
      initialLogCount: 0,
      logPrefix: 'Dispatch failed',
    } as never)
    expect(blocked).toHaveLength(0)
    expect(state.failedDispatches?.['t-852']?.count).toBe(3)
  })
})
