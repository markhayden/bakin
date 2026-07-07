/**
 * Workflow runtime tests for map_workflow fan-out/fan-in (#203).
 * Fixtures: map-flow.yaml (source → map → after) + map-child.yaml in
 * helpers/runtime-harness.ts; engine semantics per
 * .claude/specs/workflow-map-fanout-design.md.
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
  hookTasks,
} from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-runtime-map-${Date.now()}`)

// ─── CRITICAL: Mock content-dir to prevent writes to ~/.bakin/ ─────────────
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

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => testDir,
  getOpenClawPath: (...parts: string[]) => join(testDir, ...parts),
  resetOpenClawHome: mock(),
}))

import {
  createInstance,
  loadInstance,
  completeStep,
  reopenFromStep,
  cancelInstance,
  getCurrentStep,
  getActiveAgents,
  approveGate,
} from '@bakin/workflows/lib/runtime'
import {
  retryMapChild,
  cancelMapChild,
  listMapChildren,
} from '@bakin/workflows/lib/map-children'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import { setEventBus } from '@bakin/workflows/lib/notifications'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'

/** Wait for fire-and-forget board-task promises to settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('runtime — map_workflow', () => {
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

  const items = ['clip-a', 'clip-b', 'clip-c']

  const startAndFan = (taskId: string, sourceOutput: Record<string, unknown> = { items }) => {
    createInstance(taskId, 'map-flow', testDir)
    return completeStep(taskId, 'source-step', sourceOutput, undefined, testDir)
  }

  describe('fan-out', () => {
    it('spawns one child per source item with stable ids, linkage, and item context', () => {
      const result = startAndFan('task-map')
      expect(result.success).toBe(true)

      const parent = loadInstance('task-map', testDir)!
      expect(parent.status).toBe('in_progress')
      expect(parent.currentStepId).toBe('produce-items')

      const state = parent.stepStates['produce-items']
      expect(state.status).toBe('in_progress')
      expect(state.children).toHaveLength(3)

      for (let i = 0; i < 3; i++) {
        const entry = state.children![i]
        expect(entry.index).toBe(i)
        expect(entry.childTaskId).toBe(`task-map--produce-items--${i}`)
        expect(entry.status).toBe('in_progress')

        const child = loadInstance(entry.childTaskId, testDir)!
        expect(child.workflowId).toBe('map-child')
        expect(child.parentTaskId).toBe('task-map')
        expect(child.parentStepId).toBe('produce-items')
        expect(child.status).toBe('in_progress')
        // item under item_key + map coordinates + the source output MINUS the
        // array itself (spreading it would grow quadratically with width).
        expect(child.parentContext).toMatchObject({
          brief: items[i],
          mapIndex: i,
          mapTotal: 3,
        })
        expect(child.parentContext).not.toHaveProperty('items')
      }
    })

    it('creates one board task per child titled {parent} — {label} {i+1}/{N}', async () => {
      hookTasks.set('task-map-board', {
        id: 'task-map-board',
        title: 'Make variants',
        column: 'inProgress',
      })
      startAndFan('task-map-board')
      await settle()

      for (let i = 0; i < 3; i++) {
        const task = hookTasks.get(`task-map-board--produce-items--${i}`)
        expect(task, `board task ${i}`).toBeDefined()
        expect(task!.title).toBe(`Make variants — Produce Items ${i + 1}/3`)
        expect(task!.column).toBe('inProgress')
      }
    })

    it('falls back to a label-only board title when the parent task is unknown', async () => {
      startAndFan('task-map-noparent')
      await settle()
      const task = hookTasks.get('task-map-noparent--produce-items--0')
      expect(task).toBeDefined()
      expect(task!.title).toBe('Produce Items 1/3 (sub-workflow)')
    })

    it('fails typed when the source key is missing', () => {
      const result = startAndFan('task-map-nokey', { wrong: ['a'] })
      // The source step itself completed fine; the failure is on the map step.
      expect(result.success).toBe(true)

      const parent = loadInstance('task-map-nokey', testDir)!
      expect(parent.status).toBe('failed')
      const state = parent.stepStates['produce-items']
      expect(state.status).toBe('failed')
      expect(state.code).toBe('map_source_invalid')
      expect(state.error).toContain('items')
      expect(state.children).toBeUndefined()
      expect(loadInstance('task-map-nokey--produce-items--0', testDir)).toBeNull()
      expect(parent.history.at(-1)).toMatchObject({ stepId: 'produce-items', status: 'failed' })
    })

    it('fails typed when the source value is not an array', () => {
      startAndFan('task-map-notarray', { items: 'nope' })
      const parent = loadInstance('task-map-notarray', testDir)!
      expect(parent.status).toBe('failed')
      expect(parent.stepStates['produce-items'].code).toBe('map_source_invalid')
      expect(loadInstance('task-map-notarray--produce-items--0', testDir)).toBeNull()
    })

    it('fails typed with no partial spawn when items exceed max_children', () => {
      startAndFan('task-map-over', { items: ['a', 'b', 'c', 'd', 'e'] })
      const parent = loadInstance('task-map-over', testDir)!
      expect(parent.status).toBe('failed')
      const state = parent.stepStates['produce-items']
      expect(state.code).toBe('map_source_invalid')
      expect(state.error).toContain('max_children')
      for (let i = 0; i < 5; i++) {
        expect(loadInstance(`task-map-over--produce-items--${i}`, testDir)).toBeNull()
      }
    })

    it('completes immediately and advances on an empty source array', () => {
      startAndFan('task-map-empty', { items: [] })
      const parent = loadInstance('task-map-empty', testDir)!
      expect(parent.status).toBe('in_progress')
      expect(parent.stepStates['produce-items'].status).toBe('complete')
      expect(parent.stepStates['produce-items'].output).toEqual({ outputs: [] })
      expect(parent.currentStepId).toBe('after-map')
      expect(parent.stepStates['after-map'].status).toBe('in_progress')
    })

    it('recovers from map_source_invalid via reopenFromStep on the source step', () => {
      startAndFan('task-map-recover', { wrong: ['a'] })
      expect(loadInstance('task-map-recover', testDir)!.status).toBe('failed')

      const reopened = reopenFromStep('task-map-recover', {
        stepId: 'source-step',
        reason: 'produce a real array this time',
        contentDir: testDir,
      })
      expect(reopened.success).toBe(true)

      const afterReopen = loadInstance('task-map-recover', testDir)!
      expect(afterReopen.status).toBe('in_progress')
      expect(afterReopen.stepStates['produce-items'].status).toBe('pending')
      expect(afterReopen.stepStates['produce-items'].code).toBeUndefined()

      const result = completeStep('task-map-recover', 'source-step', { items: ['x'] }, undefined, testDir)
      expect(result.success).toBe(true)
      const parent = loadInstance('task-map-recover', testDir)!
      expect(parent.stepStates['produce-items'].status).toBe('in_progress')
      expect(parent.stepStates['produce-items'].children).toHaveLength(1)
    })

    it('re-fan-out after source reopen reuses child ids and cancels stale children', () => {
      startAndFan('task-map-refan')
      // All three children live. Now rewind the source step.
      const reopened = reopenFromStep('task-map-refan', {
        stepId: 'source-step',
        reason: 'redo segmentation',
        contentDir: testDir,
      })
      expect(reopened.success).toBe(true)

      // Old children still on disk, still in_progress (sweep happens at re-fan-out).
      expect(loadInstance('task-map-refan--produce-items--2', testDir)!.status).toBe('in_progress')

      // Re-complete the source with FEWER items — narrower fan.
      completeStep('task-map-refan', 'source-step', { items: ['only-a', 'only-b'] }, undefined, testDir)

      const parent = loadInstance('task-map-refan', testDir)!
      const state = parent.stepStates['produce-items']
      expect(state.children).toHaveLength(2)

      // Reused ids are fresh in_progress instances with the new items.
      const child0 = loadInstance('task-map-refan--produce-items--0', testDir)!
      expect(child0.status).toBe('in_progress')
      expect(child0.parentContext?.brief).toBe('only-a')

      // The orphaned third child was cancelled by the sweep.
      expect(loadInstance('task-map-refan--produce-items--2', testDir)!.status).toBe('cancelled')
    })

    it('re-fan-out that resolves EMPTY still sweeps the prior fan-out\'s live children', () => {
      startAndFan('task-empty-sweep')
      reopenFromStep('task-empty-sweep', { stepId: 'source-step', reason: 'redo', contentDir: testDir })
      // Old children are live; the source now legitimately produces nothing.
      completeStep('task-empty-sweep', 'source-step', { items: [] }, undefined, testDir)

      const parent = loadInstance('task-empty-sweep', testDir)!
      expect(parent.stepStates['produce-items'].status).toBe('complete')
      expect(parent.currentStepId).toBe('after-map')
      for (let i = 0; i < 3; i++) {
        expect(loadInstance(`task-empty-sweep--produce-items--${i}`, testDir)!.status).toBe('cancelled')
      }
    })

    it('re-fan-out that fails typed still sweeps the prior fan-out\'s live children', () => {
      startAndFan('task-fail-sweep')
      reopenFromStep('task-fail-sweep', { stepId: 'source-step', reason: 'redo', contentDir: testDir })
      completeStep('task-fail-sweep', 'source-step', { wrong: true }, undefined, testDir)

      expect(loadInstance('task-fail-sweep', testDir)!.status).toBe('failed')
      for (let i = 0; i < 3; i++) {
        expect(loadInstance(`task-fail-sweep--produce-items--${i}`, testDir)!.status).toBe('cancelled')
      }
    })

    it('persists fan-out state across a reload (crash-restart)', () => {
      startAndFan('task-map-reload')
      // Fresh read from disk — nothing held in memory.
      const parent = loadInstance('task-map-reload', testDir)!
      expect(parent.stepStates['produce-items'].children).toHaveLength(3)
      expect(parent.stepStates['produce-items'].children![1]).toMatchObject({
        index: 1,
        childTaskId: 'task-map-reload--produce-items--1',
        status: 'in_progress',
      })
      const child = loadInstance('task-map-reload--produce-items--1', testDir)!
      expect(child.parentStepId).toBe('produce-items')
    })

    it('defensively fails a first-step map on non-validating createInstance paths', () => {
      const instance = createInstance('task-map-first', 'map-first', testDir)
      expect(instance.status).toBe('failed')
      expect(instance.stepStates['fan'].status).toBe('failed')
      expect(instance.stepStates['fan'].code).toBe('map_source_invalid')
    })
  })

  describe('fan-in (join)', () => {
    const completeChild = (taskId: string, i: number, output?: Record<string, unknown>) =>
      completeStep(`${taskId}--produce-items--${i}`, 'do-work', output ?? { made: items[i] }, undefined, testDir)

    it('aggregates child outputs in source order regardless of completion order', () => {
      startAndFan('task-join')
      for (const i of [2, 0, 1]) {
        expect(completeChild('task-join', i).success).toBe(true)
      }

      const parent = loadInstance('task-join', testDir)!
      const state = parent.stepStates['produce-items']
      expect(state.status).toBe('complete')
      expect(state.output).toEqual({
        outputs: [{ made: 'clip-a' }, { made: 'clip-b' }, { made: 'clip-c' }],
      })
      expect(parent.currentStepId).toBe('after-map')
      expect(parent.stepStates['after-map'].status).toBe('in_progress')
      expect(parent.history.at(-1)).toMatchObject({ stepId: 'produce-items', status: 'complete' })
    })

    it('leaves the map step in_progress until every child completes', () => {
      startAndFan('task-partial')
      completeChild('task-partial', 0, { made: 'a' })

      const parent = loadInstance('task-partial', testDir)!
      const state = parent.stepStates['produce-items']
      expect(state.status).toBe('in_progress')
      expect(state.children![0].status).toBe('complete')
      expect(state.children![0].output).toEqual({ made: 'a' })
      expect(state.children![1].status).toBe('in_progress')
      expect(state.children![2].status).toBe('in_progress')
      expect(parent.currentStepId).toBe('produce-items')
    })

    it('moves each completed child board task to done as it finishes', async () => {
      startAndFan('task-board-done')
      await settle()
      completeChild('task-board-done', 1)
      await settle()
      expect(hookTasks.get('task-board-done--produce-items--1')!.column).toBe('done')
      expect(hookTasks.get('task-board-done--produce-items--0')!.column).toBe('inProgress')
    })

    it('completes the parent workflow after the map when the remaining steps finish', () => {
      startAndFan('task-full')
      for (const i of [0, 1, 2]) completeChild('task-full', i)
      const result = completeStep('task-full', 'after-map', { done: true }, undefined, testDir)
      expect(result.success).toBe(true)
      expect(result.workflowComplete).toBe(true)
      expect(loadInstance('task-full', testDir)!.status).toBe('complete')
    })

    it('propagates a map join upward through nested workflow recursion', () => {
      // Grandparent (map-wrapper) → child (map-flow, spawned as first step) →
      // grandchildren (map-child ×N).
      createInstance('task-grand', 'map-wrapper', testDir)
      const childTaskId = 'task-grand--run-map-flow'
      expect(loadInstance(childTaskId, testDir)).not.toBeNull()

      completeStep(childTaskId, 'source-step', { items: ['x', 'y'] }, undefined, testDir)
      for (const i of [1, 0]) {
        completeStep(`${childTaskId}--produce-items--${i}`, 'do-work', { made: i }, undefined, testDir)
      }
      // Child's map joined; finish the child's tail step → child completes →
      // propagation marks the grandparent's nested step complete and advances.
      completeStep(childTaskId, 'after-map', { wrapped: true }, undefined, testDir)

      const grand = loadInstance('task-grand', testDir)!
      expect(grand.stepStates['run-map-flow'].status).toBe('complete')
      expect(grand.currentStepId).toBe('wrap-after')
      const child = loadInstance(childTaskId, testDir)!
      expect(child.status).toBe('complete')
      expect(child.stepStates['produce-items'].output).toEqual({ outputs: [{ made: 0 }, { made: 1 }] })
    })

    it('is idempotent on duplicate child-completion propagation', () => {
      startAndFan('task-dup')
      completeChild('task-dup', 0)
      const afterFirst = loadInstance('task-dup', testDir)!
      // A second submission against the already-complete child step is refused
      // upstream, and the parent entry stays complete either way.
      const dup = completeStep('task-dup--produce-items--0', 'do-work', { made: 'again' }, undefined, testDir)
      expect(dup.success).toBe(false)
      const parent = loadInstance('task-dup', testDir)!
      expect(parent.stepStates['produce-items'].children![0]).toEqual(
        afterFirst.stepStates['produce-items'].children![0],
      )
    })
  })

  describe('join-blocking (failures never cascade)', () => {
    const completeChild = (taskId: string, i: number) =>
      completeStep(`${taskId}--produce-items--${i}`, 'do-work', { made: items[i] }, undefined, testDir)

    it('a cancelled child blocks the join without failing the parent or siblings', () => {
      startAndFan('task-block')
      cancelInstance('task-block--produce-items--1', testDir)
      completeChild('task-block', 0)
      completeChild('task-block', 2)

      const parent = loadInstance('task-block', testDir)!
      const state = parent.stepStates['produce-items']
      // Join waits: the map step and the parent stay honestly in_progress.
      expect(parent.status).toBe('in_progress')
      expect(state.status).toBe('in_progress')
      expect(state.output).toBeUndefined()
      expect(parent.currentStepId).toBe('produce-items')
      // Completed siblings recorded; nothing cascaded to them.
      expect(state.children![0].status).toBe('complete')
      expect(state.children![2].status).toBe('complete')
      expect(loadInstance('task-block--produce-items--0', testDir)!.status).toBe('complete')
    })

    it('refuses late submissions to a cancelled child and keeps the join intact', () => {
      startAndFan('task-late')
      cancelInstance('task-late--produce-items--1', testDir)
      const late = completeStep('task-late--produce-items--1', 'do-work', { made: 'zombie' }, undefined, testDir)
      expect(late.success).toBe(false)

      completeChild('task-late', 0)
      completeChild('task-late', 2)
      const state = loadInstance('task-late', testDir)!.stepStates['produce-items']
      expect(state.status).toBe('in_progress')
      expect(state.children![1].output).toBeUndefined()
    })
  })

  describe('per-child recovery', () => {
    const completeChild = (taskId: string, i: number) =>
      completeStep(`${taskId}--produce-items--${i}`, 'do-work', { made: items[i] }, undefined, testDir)

    it('cancelMapChild blocks the join; retryMapChild re-creates the same id and unblocks it', async () => {
      startAndFan('task-recover-cycle')
      await settle()

      const cancelled = cancelMapChild('task-recover-cycle', 'produce-items', 1, testDir)
      expect(cancelled.success).toBe(true)
      await settle()

      expect(loadInstance('task-recover-cycle--produce-items--1', testDir)!.status).toBe('cancelled')
      let state = loadInstance('task-recover-cycle', testDir)!.stepStates['produce-items']
      expect(state.children![1].status).toBe('cancelled')
      expect(hookTasks.get('task-recover-cycle--produce-items--1')!.column).toBe('done')

      // Complete the siblings — join must stay blocked on the cancelled child.
      completeChild('task-recover-cycle', 0)
      completeChild('task-recover-cycle', 2)
      state = loadInstance('task-recover-cycle', testDir)!.stepStates['produce-items']
      expect(state.status).toBe('in_progress')

      // Retry re-creates a fresh instance under the SAME childTaskId with the
      // same item context, revives the board task, and resets the entry.
      const retried = retryMapChild('task-recover-cycle', 'produce-items', 1, { reason: 'try again', contentDir: testDir })
      expect(retried.success).toBe(true)
      await settle()

      const revived = loadInstance('task-recover-cycle--produce-items--1', testDir)!
      expect(revived.status).toBe('in_progress')
      expect(revived.parentContext).toMatchObject({ brief: 'clip-b', mapIndex: 1, mapTotal: 3 })
      expect(revived.parentTaskId).toBe('task-recover-cycle')
      expect(hookTasks.get('task-recover-cycle--produce-items--1')!.column).toBe('inProgress')

      // Completing the retried child completes the join in source order.
      completeChild('task-recover-cycle', 1)
      const joined = loadInstance('task-recover-cycle', testDir)!
      expect(joined.stepStates['produce-items'].status).toBe('complete')
      expect(joined.stepStates['produce-items'].output).toEqual({
        outputs: [{ made: 'clip-a' }, { made: 'clip-b' }, { made: 'clip-c' }],
      })
      expect(joined.currentStepId).toBe('after-map')
    })

    it('retryMapChild reopens a LIVE child in place (reason lands as rejection context)', () => {
      startAndFan('task-retry-live')
      const retried = retryMapChild('task-retry-live', 'produce-items', 0, { reason: 'redo this one', contentDir: testDir })
      expect(retried.success).toBe(true)

      const child = loadInstance('task-retry-live--produce-items--0', testDir)!
      expect(child.status).toBe('in_progress')
      expect(child.stepStates['do-work'].rejectionReason).toBe('redo this one')
      // Same instance reopened, not re-created — history carries the reopen.
      expect(child.history.some((h) => (h.output as { reopened?: boolean } | undefined)?.reopened)).toBe(true)
    })

    it('refuses to retry or cancel a completed child', () => {
      startAndFan('task-refuse')
      completeChild('task-refuse', 0)
      const retry = retryMapChild('task-refuse', 'produce-items', 0, { reason: 'nope', contentDir: testDir })
      expect(retry.success).toBe(false)
      const cancel = cancelMapChild('task-refuse', 'produce-items', 0, testDir)
      expect(cancel.success).toBe(false)
    })

    it('returns typed errors for unknown parent, step, or index', () => {
      expect(retryMapChild('ghost-task', 'produce-items', 0, { reason: 'x', contentDir: testDir }).success).toBe(false)
      startAndFan('task-bad-args')
      expect(retryMapChild('task-bad-args', 'not-a-map', 0, { reason: 'x', contentDir: testDir }).success).toBe(false)
      expect(retryMapChild('task-bad-args', 'produce-items', 9, { reason: 'x', contentDir: testDir }).success).toBe(false)
      expect(cancelMapChild('task-bad-args', 'produce-items', 9, testDir).success).toBe(false)
    })

    it('listMapChildren reports LIVE child statuses, not just the cached entries', () => {
      startAndFan('task-list')
      // Cancel one child OUT OF BAND — the parent entry still says in_progress.
      cancelInstance('task-list--produce-items--2', testDir)

      const listed = listMapChildren('task-list', 'produce-items', testDir)
      expect(listed.success).toBe(true)
      if (!listed.success) throw new Error('unreachable')
      const children = listed.children
      expect(children).toHaveLength(3)
      expect(children[0]).toMatchObject({ index: 0, entryStatus: 'in_progress', liveStatus: 'in_progress' })
      expect(children[2]).toMatchObject({ index: 2, entryStatus: 'in_progress', liveStatus: 'cancelled' })
    })

    it('child gate approvals flow through to the join', () => {
      createInstance('task-gated', 'map-gated', testDir)
      completeStep('task-gated', 'source-step', { items: ['x', 'y'] }, undefined, testDir)

      for (const i of [0, 1]) {
        const childId = `task-gated--produce-items--${i}`
        completeStep(childId, 'work', { draft: i }, undefined, testDir)
        expect(loadInstance(childId, testDir)!.status).toBe('pending_approval')
        const approval = approveGate(childId, 'check', { contentDir: testDir, approver: { id: 'mark', source: 'web' } })
        expect(approval.success).toBe(true)
        completeStep(childId, 'finish', { final: i }, undefined, testDir)
      }

      const parent = loadInstance('task-gated', testDir)!
      expect(parent.stepStates['produce-items'].status).toBe('complete')
      expect(parent.stepStates['produce-items'].output).toEqual({
        outputs: [{ final: 0 }, { final: 1 }],
      })
      expect(parent.currentStepId).toBe('after-map')
    })
  })

  describe('child-aware surfaces', () => {
    const completeChild = (taskId: string, i: number) =>
      completeStep(`${taskId}--produce-items--${i}`, 'do-work', { made: items[i] }, undefined, testDir)

    it('cancel-parent sweeps live children and leaves completed ones untouched', async () => {
      startAndFan('task-sweep')
      await settle() // board tasks are fire-and-forget; let them land before cancelling
      completeChild('task-sweep', 0)
      cancelInstance('task-sweep', testDir)
      await settle()

      expect(loadInstance('task-sweep', testDir)!.status).toBe('cancelled')
      expect(loadInstance('task-sweep--produce-items--0', testDir)!.status).toBe('complete')
      expect(loadInstance('task-sweep--produce-items--1', testDir)!.status).toBe('cancelled')
      expect(loadInstance('task-sweep--produce-items--2', testDir)!.status).toBe('cancelled')

      const entries = loadInstance('task-sweep', testDir)!.stepStates['produce-items'].children!
      expect(entries.map((e) => e.status)).toEqual(['complete', 'cancelled', 'cancelled'])
      expect(hookTasks.get('task-sweep--produce-items--1')!.column).toBe('done')
    })

    it('cancel-parent with mixed child states sweeps only the live ones', async () => {
      // Gated children: child 0 runs to completion, child 1 parks at its gate
      // (pending_approval), child 2 (map-flow fixture is ungated, so use the
      // gated parent with 3 items) is cancelled per-child beforehand.
      createInstance('task-mixed', 'map-gated', testDir)
      completeStep('task-mixed', 'source-step', { items: ['a', 'b', 'c'] }, undefined, testDir)
      await settle()

      // Child 0 → complete.
      completeStep('task-mixed--produce-items--0', 'work', { draft: 0 }, undefined, testDir)
      approveGate('task-mixed--produce-items--0', 'check', { contentDir: testDir, approver: { id: 'mark', source: 'web' } })
      completeStep('task-mixed--produce-items--0', 'finish', { final: 0 }, undefined, testDir)
      // Child 1 → parked at its gate.
      completeStep('task-mixed--produce-items--1', 'work', { draft: 1 }, undefined, testDir)
      expect(loadInstance('task-mixed--produce-items--1', testDir)!.status).toBe('pending_approval')
      // Child 2 → already cancelled per-child.
      cancelMapChild('task-mixed', 'produce-items', 2, testDir)

      cancelInstance('task-mixed', testDir)
      await settle()

      const parent = loadInstance('task-mixed', testDir)!
      expect(parent.status).toBe('cancelled')
      expect(parent.stepStates['produce-items'].children!.map((c) => c.status)).toEqual([
        'complete', 'cancelled', 'cancelled',
      ])
      expect(loadInstance('task-mixed--produce-items--0', testDir)!.status).toBe('complete')
      expect(loadInstance('task-mixed--produce-items--1', testDir)!.status).toBe('cancelled')
      expect(loadInstance('task-mixed--produce-items--2', testDir)!.status).toBe('cancelled')
    })

    it('cancel-parent AFTER a source reopen still sweeps the orphaned live children', () => {
      // A source-step reopen wipes children[] while the child instances keep
      // running — cancellation must rediscover them from the store.
      startAndFan('task-orphan-sweep')
      reopenFromStep('task-orphan-sweep', { stepId: 'source-step', reason: 'redo', contentDir: testDir })
      expect(loadInstance('task-orphan-sweep', testDir)!.stepStates['produce-items'].children).toBeUndefined()
      expect(loadInstance('task-orphan-sweep--produce-items--1', testDir)!.status).toBe('in_progress')

      cancelInstance('task-orphan-sweep', testDir)
      for (let i = 0; i < 3; i++) {
        expect(loadInstance(`task-orphan-sweep--produce-items--${i}`, testDir)!.status).toBe('cancelled')
      }
    })

    it('a child that fails during spawn gets an honest failed entry, not in_progress', () => {
      // map-broken-child fans out into map-first, whose defensive first-step
      // map fails at createInstance time.
      const { writeFileSync } = require('fs') as typeof import('fs')
      const { join: j } = require('path') as typeof import('path')
      writeFileSync(j(testDir, 'workflows', 'definitions', 'map-broken-parent.yaml'), `name: Map Broken Parent
description: children fail at spawn
version: 1
steps:
  - id: source-step
    type: agent
    label: Segment
    agent: chef
  - id: produce-items
    type: map_workflow
    label: Produce Items
    source: source-step.items
    workflow_id: map-first
  - id: after-map
    type: agent
    label: After
    agent: main
`)
      createInstance('task-spawn-fail', 'map-broken-parent', testDir)
      completeStep('task-spawn-fail', 'source-step', { items: ['a', 'b'] }, undefined, testDir)

      const entries = loadInstance('task-spawn-fail', testDir)!.stepStates['produce-items'].children!
      expect(entries.map((e) => e.status)).toEqual(['failed', 'failed'])
    })

    it('getActiveAgents unions the live children with effectiveTaskIds', () => {
      startAndFan('task-agents')
      const before = getActiveAgents('task-agents', testDir)
      expect(before).toHaveLength(3)
      for (let i = 0; i < 3; i++) {
        expect(before[i]).toEqual({
          agent: 'pixel',
          stepId: 'do-work',
          effectiveTaskId: `task-agents--produce-items--${i}`,
        })
      }

      completeChild('task-agents', 1)
      const after = getActiveAgents('task-agents', testDir)
      expect(after.map((a) => a.effectiveTaskId)).toEqual([
        'task-agents--produce-items--0',
        'task-agents--produce-items--2',
      ])
    })

    it('getCurrentStep reports fanned_out mid-map and a typed failed context after map_source_invalid', () => {
      startAndFan('task-ctx')
      // Not null — null means "no workflow instance" on the REST/tool surfaces.
      expect(getCurrentStep('task-ctx', undefined, testDir)).toMatchObject({
        status: 'fanned_out',
        stepId: 'produce-items',
        childrenTotal: 3,
        childrenComplete: 0,
      })

      createInstance('task-ctx-fail', 'map-flow', testDir)
      const result = completeStep('task-ctx-fail', 'source-step', { wrong: [] }, undefined, testDir)
      expect(result.success).toBe(true)
      expect(result.nextStep).toMatchObject({ status: 'failed', stepId: 'produce-items', code: 'map_source_invalid' })

      const ctx = getCurrentStep('task-ctx-fail', undefined, testDir)
      expect(ctx).toMatchObject({ status: 'failed', stepId: 'produce-items', code: 'map_source_invalid' })
    })

    it('refuses to reopen AT a map step — recovery is the source step or per-child retry', () => {
      startAndFan('task-noreopen')
      const result = reopenFromStep('task-noreopen', {
        stepId: 'produce-items',
        reason: 'nope',
        contentDir: testDir,
      })
      expect(result.success).toBe(false)
      expect((result as { errors: string[] }).errors[0]).toContain('source step')
      // Nothing was reset.
      expect(loadInstance('task-noreopen', testDir)!.stepStates['produce-items'].children).toHaveLength(3)
    })
  })
})
