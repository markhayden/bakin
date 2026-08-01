/**
 * Workflow runtime tests for the gates seam (lib/gates.ts):
 * approveGate/rejectGate, rewind, reopenFromStep, and previousOutput
 * preservation on rejection.
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
  addTaskLogHook,
  moveTaskHook,
} from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-runtime-gates-${Date.now()}`)

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
  loadInstance,
  getCurrentStep,
  completeStep,
  approveGate,
  rejectGate,
  reopenFromStep,
  cancelInstance,
} from '@bakin/workflows/lib/runtime'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import { setEventBus } from '@bakin/workflows/lib/notifications'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { settleFor, waitUntil } from '../../helpers/wait'

describe('runtime — gates', () => {

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

  // ─── Gate operations ──────────────────────────────────────────────

  describe('gate operations', () => {
    it('approveGate advances past gate to next step', () => {
      createInstance('task-gate-a', 'gate', testDir)
      completeStep('task-gate-a', 'write-copy', { text: 'hello' }, undefined, testDir)

      const approveResult = approveGate('task-gate-a', 'review-gate', { contentDir: testDir })
      expect(approveResult.success).toBe(true)

      const instance = loadInstance('task-gate-a', testDir)
      expect(instance!.currentStepId).toBe('publish')
      expect(instance!.status).toBe('in_progress')
    })

    it('approveGate on the final step completes the workflow (advance is purely positional)', () => {
      createInstance('task-gate-final', 'final-gate', testDir)
      completeStep('task-gate-final', 'write-copy', { text: 'hello' }, undefined, testDir)

      const approveResult = approveGate('task-gate-final', 'publish-gate', { contentDir: testDir })
      expect(approveResult.success).toBe(true)

      const instance = loadInstance('task-gate-final', testDir)
      expect(instance!.status).toBe('complete')
      expect(instance!.stepStates['publish-gate'].status).toBe('complete')
    })

    it('rejectGate rewinds to target step', () => {
      createInstance('task-gate-r', 'gate', testDir)
      completeStep('task-gate-r', 'write-copy', { text: 'hello' }, undefined, testDir)

      const rejectResult = rejectGate('task-gate-r', 'review-gate', 'Not good enough', { contentDir: testDir })
      expect(rejectResult.success).toBe(true)
      expect(rejectResult.rewoundTo).toBe('write-copy')

      const instance = loadInstance('task-gate-r', testDir)
      expect(instance!.currentStepId).toBe('write-copy')
      expect(instance!.stepStates['write-copy'].status).toBe('in_progress')
    })

    it('rejectGate with note_to_agent includes reason in step context', () => {
      createInstance('task-gate-n', 'gate', testDir)
      completeStep('task-gate-n', 'write-copy', { text: 'hello' }, undefined, testDir)

      rejectGate('task-gate-n', 'review-gate', 'Caption too long', { contentDir: testDir })

      const instance = loadInstance('task-gate-n', testDir)
      expect(instance!.stepStates['write-copy'].rejectionReason).toBe('Caption too long')

      const step = getCurrentStep('task-gate-n', undefined, testDir)
      expect((step as Record<string, unknown>).rejectionReason).toBe('Caption too long')
    })

    it('returns error when approving non-gate step', () => {
      createInstance('task-gate-bad', 'linear', testDir)
      const result = approveGate('task-gate-bad', 'step-one', { contentDir: testDir })
      expect(result.success).toBe(false)
      expect(result.errors![0]).toContain('not a gate')
    })

    it('returns error when gate is not pending_approval', () => {
      createInstance('task-gate-np', 'gate', testDir)
      // Gate is still pending (not reached yet)
      const result = approveGate('task-gate-np', 'review-gate', { contentDir: testDir })
      expect(result.success).toBe(false)
    })

    // ─── Decision timeline (issue #91) ──────────────────────────────────

    it('advanceWorkflow sets requestedAt when gate enters pending_approval', () => {
      createInstance('task-gate-req', 'gate', testDir)
      completeStep('task-gate-req', 'write-copy', { text: 'hello' }, undefined, testDir)

      const instance = loadInstance('task-gate-req', testDir)
      const gateState = instance!.stepStates['review-gate']
      expect(gateState.status).toBe('pending_approval')
      expect(gateState.requestedAt).toBeTruthy()
      expect(new Date(gateState.requestedAt!).getTime()).not.toBeNaN()
    })

    it('approveGate persists decidedAt and approver', () => {
      createInstance('task-gate-app', 'gate', testDir)
      completeStep('task-gate-app', 'write-copy', { text: 'hello' }, undefined, testDir)

      approveGate('task-gate-app', 'review-gate', {
        contentDir: testDir,
        approver: { source: 'channel', id: '999', displayName: 'Approver Person' },
      })

      const instance = loadInstance('task-gate-app', testDir)
      const gateState = instance!.stepStates['review-gate']
      expect(gateState.decidedAt).toBeTruthy()
      expect(gateState.approver).toEqual({
        source: 'channel',
        id: '999',
        displayName: 'Approver Person',
      })
    })

    it('approveGate emits the gate approver in the workflow event', () => {
      const emitted: Array<{ event: string; data: Record<string, unknown> }> = []
      setEventBus({
        emit: (event: string, data: Record<string, unknown>) => emitted.push({ event, data }),
      } as never)
      createInstance('task-gate-event', 'gate', testDir)
      completeStep('task-gate-event', 'write-copy', { text: 'hello' }, undefined, testDir)

      approveGate('task-gate-event', 'review-gate', {
        contentDir: testDir,
        approver: { source: 'web', id: 'roscoe', displayName: 'roscoe' },
      })

      const approved = emitted.find(item => item.event === 'workflow.gate_approved')
      expect(approved?.data.approver).toEqual({ source: 'web', id: 'roscoe', displayName: 'roscoe' })
    })

    it('rejectGate records decidedAt and approver in history (durable across rewind reset)', () => {
      createInstance('task-gate-rej', 'gate', testDir)
      completeStep('task-gate-rej', 'write-copy', { text: 'hello' }, undefined, testDir)

      const result = rejectGate('task-gate-rej', 'review-gate', 'Not approved', {
        contentDir: testDir,
        approver: { source: 'web', id: 'mark', displayName: 'mark' },
      })

      // Decision is returned in result so callers don't need to reload
      expect(result.decision).toBeDefined()
      expect(result.decision!.approver).toEqual({ source: 'web', id: 'mark', displayName: 'mark' })
      expect(result.decision!.decidedAt).toBeTruthy()
      expect(result.decision!.reason).toBe('Not approved')

      // History entry is the durable record (gate stepState gets reset on rewind)
      const instance = loadInstance('task-gate-rej', testDir)
      const rejectionEntry = instance!.history.find(h => h.stepId === 'review-gate' && h.status === 'rejected')
      expect(rejectionEntry).toBeDefined()
      expect(rejectionEntry!.approver).toEqual({ source: 'web', id: 'mark', displayName: 'mark' })
      expect(rejectionEntry!.rejectionReason).toBe('Not approved')
    })

    it('approveGate returns decision in result with computed durationMs', async () => {
      createInstance('task-gate-dur', 'gate', testDir)
      completeStep('task-gate-dur', 'write-copy', { text: 'hello' }, undefined, testDir)

      // A real elapsed window is the point: durationMs is computed from the
      // wall clock, so there is no condition to poll for.
      await settleFor(5, 'let real time pass so the gate records a non-zero durationMs')

      const result = approveGate('task-gate-dur', 'review-gate', {
        contentDir: testDir,
        approver: { source: 'channel', id: '999', displayName: 'Approver' },
      })

      expect(result.decision).toBeDefined()
      expect(result.decision!.gateLabel).toBeTruthy()
      expect(result.decision!.requestedAt).toBeTruthy()
      expect(result.decision!.decidedAt).toBeTruthy()
      expect(result.decision!.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ─── Rewind ─────────────────────────────────────────────────────────

  describe('rewind', () => {
    it('resets rewound step to in_progress and all steps after to pending', () => {
      createInstance('task-rew', 'gate', testDir)
      completeStep('task-rew', 'write-copy', { text: 'hello' }, undefined, testDir)

      rejectGate('task-rew', 'review-gate', 'redo it', { contentDir: testDir })

      const instance = loadInstance('task-rew', testDir)
      expect(instance!.stepStates['write-copy'].status).toBe('in_progress')
      expect(instance!.stepStates['review-gate'].status).toBe('pending')
      expect(instance!.stepStates['publish'].status).toBe('pending')
    })
  })

  describe('reopenFromStep', () => {
    it('reopens a completed workflow at the actionable step before a gate', async () => {
      createInstance('task-reopen-gate', 'gate', testDir)
      completeStep('task-reopen-gate', 'write-copy', { text: 'hello' }, undefined, testDir)
      approveGate('task-reopen-gate', 'review-gate', { contentDir: testDir })
      completeStep('task-reopen-gate', 'publish', { ref: 'posted' }, undefined, testDir)

      const result = reopenFromStep('task-reopen-gate', {
        stepId: 'review-gate',
        reason: 'Messaging recovery requested',
        actor: { id: 'mark', source: 'web' },
        contentDir: testDir,
      })

      expect(result.success).toBe(true)
      expect(result.reopenedStepId).toBe('write-copy')
      const instance = loadInstance('task-reopen-gate', testDir)!
      expect(instance.status).toBe('in_progress')
      expect(instance.currentStepId).toBe('write-copy')
      expect(instance.stepStates['write-copy'].status).toBe('in_progress')
      expect(instance.stepStates['review-gate'].status).toBe('pending')
      expect(instance.stepStates.publish.status).toBe('pending')

      await waitUntil(() => addTaskLogHook.mock.calls.length > 0,
        { label: 'the task-log hook to fire after the gate reopens' })
      expect(addTaskLogHook).toHaveBeenCalledWith(expect.objectContaining({
        identifier: 'task-reopen-gate',
        author: 'workflow',
        message: expect.stringContaining('Messaging recovery requested'),
      }))
      expect(moveTaskHook).toHaveBeenCalledWith({ identifier: 'task-reopen-gate', to: 'inProgress', from: undefined })
    })

    it('reopens a completed workflow at a direct step', () => {
      createInstance('task-reopen-direct', 'linear', testDir)
      completeStep('task-reopen-direct', 'step-one', { result: 'a' }, undefined, testDir)
      completeStep('task-reopen-direct', 'step-two', { result: 'b' }, undefined, testDir)
      completeStep('task-reopen-direct', 'step-three', { result: 'c' }, undefined, testDir)

      const result = reopenFromStep('task-reopen-direct', {
        stepId: 'step-two',
        reason: 'Redo the middle step',
        actor: { id: 'mark', source: 'web' },
        contentDir: testDir,
      })

      expect(result.success).toBe(true)
      expect(result.reopenedStepId).toBe('step-two')
      const instance = loadInstance('task-reopen-direct', testDir)!
      expect(instance.status).toBe('in_progress')
      expect(instance.currentStepId).toBe('step-two')
      expect(instance.stepStates['step-one'].status).toBe('complete')
      expect(instance.stepStates['step-two'].status).toBe('in_progress')
      expect(instance.stepStates['step-three'].status).toBe('pending')
    })

    it('rejects cancelled workflow instances', () => {
      createInstance('task-reopen-cancelled', 'linear', testDir)
      cancelInstance('task-reopen-cancelled', testDir)

      const result = reopenFromStep('task-reopen-cancelled', {
        stepId: 'step-one',
        reason: 'Try to recover',
        actor: { id: 'mark', source: 'web' },
        contentDir: testDir,
      })

      expect(result.success).toBe(false)
      expect(result.errors).toEqual(['Cancelled workflow instances cannot be reopened'])
    })

    it('rejects mismatched workflow instance ids', () => {
      createInstance('task-reopen-mismatch', 'linear', testDir)

      const result = reopenFromStep('task-reopen-mismatch', {
        instanceId: 'different-instance',
        stepId: 'step-one',
        reason: 'Try to recover the wrong instance',
        actor: { id: 'mark', source: 'web' },
        contentDir: testDir,
      })

      expect(result.success).toBe(false)
      expect(result.errors).toEqual(['Workflow instance does not match task'])
    })
  })

  // ─── previousOutput on rejection ────────────────────────────────────

  describe('previousOutput on rejection', () => {
    it('preserves previousOutput when gate rejects and rewinds', () => {
      createInstance('task-prev', 'gate', testDir)
      completeStep('task-prev', 'write-copy', { text: 'original work' }, undefined, testDir)

      // Gate is pending_approval — reject it
      rejectGate('task-prev', 'review-gate', 'Too short', { contentDir: testDir })

      const instance = loadInstance('task-prev', testDir)
      expect(instance!.stepStates['write-copy'].previousOutput).toEqual({ text: 'original work' })
    })

    it('passes previousOutput through getCurrentStep context', () => {
      createInstance('task-prev-ctx', 'gate', testDir)
      completeStep('task-prev-ctx', 'write-copy', { text: 'original work' }, undefined, testDir)
      rejectGate('task-prev-ctx', 'review-gate', 'Redo it', { contentDir: testDir })

      const step = getCurrentStep('task-prev-ctx', undefined, testDir) as Record<string, unknown>
      expect(step.previousOutput).toEqual({ text: 'original work' })
    })
  })
})
