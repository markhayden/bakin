/**
 * Workflow runtime tests for the task-bridge seam (lib/task-bridge.ts):
 * store moves route through task-service's syncLedgerForStoreMove (#482).
 * Split from runtime.test.ts (FW7); shared scaffold in helpers/runtime-harness.ts.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  taskStoreMock,
  taskServiceMock,
  resetRuntimeHarness,
  seedWorkflowFixtures,
  syncLedgerForStoreMoveHook,
} from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-runtime-task-bridge-${Date.now()}`)

// ─── CRITICAL: Mock content-dir to prevent writes to ~/.bakin/ ─────────────
// (mock.module stays per-file; the shared hook fakes, module shapes, and
// workflow fixtures live in helpers/runtime-harness.ts)
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('../../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

mock.module('../../../src/core/task-service', taskServiceMock)
mock.module('@/core/task-service', taskServiceMock)

// Mock audit to prevent writes to audit.jsonl
mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

// Mock logger to prevent noise
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

// Defense-in-depth: even if another module reaches openclaw-home, redirect it
// into testDir instead of ~/.openclaw/.
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => testDir,
  getOpenClawPath: (...parts: string[]) => join(testDir, ...parts),
  resetOpenClawHome: mock(),
}))

import {
  createInstance,
  completeStep,
  reopenFromStep,
} from '@bakin/workflows/lib/runtime'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import { setEventBus } from '@bakin/workflows/lib/notifications'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { waitUntil } from '../../helpers/wait'

describe('runtime — task-bridge', () => {

  beforeEach(() => {
    invalidateSkillCache()
    resetRuntimeHarness()
    seedWorkflowFixtures(testDir)
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    getHookRegistry().clearAll()
    setEventBus({ emit: () => {} } as never)
  })

  // ─── Ledger sync wiring (#482) ─────────────────────────────────────

  describe('ledger sync wiring', () => {
    it('workflow completion lands the task on done through the ledger-sync helper', async () => {
      createInstance('task-ledger-done', 'linear', testDir)
      completeStep('task-ledger-done', 'step-one', { r: 1 }, undefined, testDir)
      completeStep('task-ledger-done', 'step-two', { r: 2 }, undefined, testDir)
      completeStep('task-ledger-done', 'step-three', { r: 3 }, undefined, testDir)

      await waitUntil(() => syncLedgerForStoreMoveHook.mock.calls.length > 0,
        { label: 'the ledger sync hook to fire for the completed step' })
      expect(syncLedgerForStoreMoveHook).toHaveBeenCalledWith(
        'task-ledger-done', 'done', 'workflow', expect.anything(),
      )
    })

    it('reopen moves the task off done through the ledger-sync helper', async () => {
      createInstance('task-ledger-reopen', 'linear', testDir)
      completeStep('task-ledger-reopen', 'step-one', { r: 1 }, undefined, testDir)
      completeStep('task-ledger-reopen', 'step-two', { r: 2 }, undefined, testDir)
      completeStep('task-ledger-reopen', 'step-three', { r: 3 }, undefined, testDir)
      syncLedgerForStoreMoveHook.mockClear()

      const result = reopenFromStep('task-ledger-reopen', {
        stepId: 'step-two',
        reason: 'Redo it',
        actor: { id: 'mark', source: 'web' },
        contentDir: testDir,
      })
      expect(result.success).toBe(true)

      await waitUntil(() => syncLedgerForStoreMoveHook.mock.calls.length > 0,
        { label: 'the ledger sync hook to fire for the reopened task' })
      expect(syncLedgerForStoreMoveHook).toHaveBeenCalledWith(
        'task-ledger-reopen', 'inProgress', 'workflow', expect.anything(),
      )
    })
  })
})
