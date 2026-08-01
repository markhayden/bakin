/**
 * Workflow runtime tests for the engine seam (lib/engine.ts):
 * createInstance (incl. the createTask node dispatched via lib/node-dispatch.ts),
 * completeStep/advanceWorkflow, and nested child workflows.
 * Split from runtime.test.ts (FW7); shared scaffold in helpers/runtime-harness.ts.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  taskStoreMock,
  taskServiceMock,
  resetRuntimeHarness,
  seedWorkflowFixtures,
  hookTasks,
  createTaskHook,
  createTaskWithEffectsHook,
  moveTaskHook,
} from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-runtime-engine-${Date.now()}`)

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
  reconcilePendingApprovalTaskColumns,
  getActiveAgents,
  cancelInstance,
} from '@bakin/workflows/lib/runtime'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import { setEventBus } from '@bakin/workflows/lib/notifications'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { waitUntil } from '../../helpers/wait'

describe('runtime — engine', () => {
  const defsDir = join(testDir, 'workflows', 'definitions')

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

  // ─── createInstance ─────────────────────────────────────────────────

  describe('createInstance', () => {
    it('creates an instance with all steps set to pending except first', () => {
      const instance = createInstance('task-1', 'linear', testDir)
      expect(instance.taskId).toBe('task-1')
      expect(instance.workflowId).toBe('linear')
      expect(instance.status).toBe('in_progress')
      expect(instance.currentStepId).toBe('step-one')
      expect(instance.stepStates['step-one'].status).toBe('in_progress')
      expect(instance.stepStates['step-two'].status).toBe('pending')
      expect(instance.stepStates['step-three'].status).toBe('pending')
    })

    it('executes a builtin createTask node once and advances to the next step', async () => {
      createTaskWithEffectsHook.mockResolvedValueOnce({ id: 'task-parent--make-task', workflowId: undefined })

      const instance = createInstance('task-parent', 'task-node', testDir)
      await waitUntil(() => loadInstance('task-parent', testDir)?.currentStepId === 'after-create',
        { label: 'the createTask node to complete and advance to after-create' })

      const saved = loadInstance('task-parent', testDir)!
      expect(instance.workflowId).toBe('task-node')
      expect(saved.currentStepId).toBe('after-create')
      expect(saved.stepStates['make-task'].status).toBe('complete')
      expect(saved.stepStates['make-task'].output).toEqual({
        taskId: 'task-parent--make-task',
        created: true,
      })
      expect(createTaskWithEffectsHook).toHaveBeenCalledWith(expect.objectContaining({
        id: 'task-parent--make-task',
        title: 'Prep Instagram Reel',
        assignee: 'patch',
        description: 'Prepare the channel deliverable.',
        parentId: 'task-parent',
        availableAt: '2026-05-18T15:00:00.000Z',
        dueAt: '2026-05-22T15:00:00.000Z',
        source: {
          pluginId: 'messaging',
          entityType: 'deliverable',
          entityId: 'deliverable-1',
          purpose: 'kickoff',
        },
        channel: 'system',
      }))
    })

    it('treats an existing createTask node task as idempotent', async () => {
      hookTasks.set('task-parent--make-task', {
        id: 'task-parent--make-task',
        title: 'Existing',
        column: 'todo',
      })

      createInstance('task-parent', 'task-node', testDir)
      await waitUntil(() => loadInstance('task-parent', testDir)?.currentStepId === 'after-create',
        { label: 'the createTask node to complete and advance to after-create' })

      const saved = loadInstance('task-parent', testDir)!
      expect(saved.currentStepId).toBe('after-create')
      expect(saved.stepStates['make-task'].output).toEqual({
        taskId: 'task-parent--make-task',
        created: false,
      })
      expect(createTaskWithEffectsHook).not.toHaveBeenCalled()
    })

    it('persists the instance to disk', () => {
      const instance = createInstance('task-2', 'linear', testDir)
      const loaded = loadInstance('task-2', testDir)
      expect(loaded).not.toBeNull()
      expect(loaded!.instanceId).toBe(instance.instanceId)
    })

    it('throws for unknown workflow definition', () => {
      expect(() => createInstance('task-x', 'nonexistent', testDir)).toThrow()
    })

    it('throws for empty draft workflows before reading the first step', () => {
      writeFileSync(join(defsDir, 'draft.yaml'), `
name: Draft
description: Not ready to run
version: 1
steps: []
`)

      expect(() => createInstance('task-draft', 'draft', testDir)).toThrow(/at least one step/)
    })
  })

  // ─── completeStep ─────────────────────────────────────────────────

  describe('completeStep', () => {
    it('advances to next step on valid output', () => {
      createInstance('task-adv', 'linear', testDir)
      const result = completeStep('task-adv', 'step-one', { result: 'done' }, undefined, testDir)
      expect(result.success).toBe(true)
      const instance = loadInstance('task-adv', testDir)
      expect(instance!.currentStepId).toBe('step-two')
      expect(instance!.stepStates['step-one'].status).toBe('complete')
      expect(instance!.stepStates['step-two'].status).toBe('in_progress')
    })

    it('returns pending approval as the next step when completion reaches a gate', () => {
      createInstance('task-next-gate', 'gate', testDir)

      const result = completeStep('task-next-gate', 'write-copy', { text: 'hello' }, 'chef', testDir)

      expect(result.success).toBe(true)
      expect(result.nextStep).toMatchObject({
        status: 'pending_approval',
        stepId: 'review-gate',
      })
    })

    it('moves a todo workflow task through inProgress before review when a gate is reached', async () => {
      hookTasks.set('task-review-from-todo', {
        id: 'task-review-from-todo',
        title: 'Review from todo',
        column: 'todo',
      })
      createInstance('task-review-from-todo', 'gate', testDir)

      completeStep('task-review-from-todo', 'write-copy', { text: 'hello' }, 'chef', testDir)
      await waitUntil(() => moveTaskHook.mock.calls.length >= 2,
        { label: 'both move-task hook calls (inProgress then review)' })

      expect(moveTaskHook).toHaveBeenNthCalledWith(1, {
        identifier: 'task-review-from-todo',
        to: 'inProgress',
        from: undefined,
      })
      expect(moveTaskHook).toHaveBeenNthCalledWith(2, {
        identifier: 'task-review-from-todo',
        to: 'review',
        from: undefined,
      })
      expect(hookTasks.get('task-review-from-todo')?.column).toBe('review')
    })

    it('repairs pending approval workflow tasks that were left in todo', async () => {
      hookTasks.set('task-reconcile-review', {
        id: 'task-reconcile-review',
        title: 'Reconcile review',
        column: 'todo',
      })
      createInstance('task-reconcile-review', 'gate', testDir)
      completeStep('task-reconcile-review', 'write-copy', { text: 'hello' }, 'chef', testDir)
      // Both calls must land BEFORE mockClear, or a straggler pollutes the
      // reconcile assertions below.
      await waitUntil(() => moveTaskHook.mock.calls.length >= 2,
        { label: 'both step-completion move-task calls to land before the mock is cleared' })

      hookTasks.get('task-reconcile-review')!.column = 'todo'
      moveTaskHook.mockClear()

      const result = await reconcilePendingApprovalTaskColumns(testDir)

      expect(result).toMatchObject({ checked: 1, moved: 1, skipped: 0 })
      expect(moveTaskHook).toHaveBeenNthCalledWith(1, {
        identifier: 'task-reconcile-review',
        to: 'inProgress',
        from: undefined,
      })
      expect(moveTaskHook).toHaveBeenNthCalledWith(2, {
        identifier: 'task-reconcile-review',
        to: 'review',
        from: undefined,
      })
      expect(hookTasks.get('task-reconcile-review')?.column).toBe('review')
    })

    it('rejects invalid output and does not advance', () => {
      createInstance('task-schema', 'skill-test', testDir)
      // Step 'write' has a skill with output_schema requiring caption: string
      const result = completeStep('task-schema', 'write', {}, undefined, testDir)
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      const instance = loadInstance('task-schema', testDir)
      expect(instance!.currentStepId).toBe('write')
    })

    it('marks workflow complete on final step', () => {
      createInstance('task-final', 'linear', testDir)
      completeStep('task-final', 'step-one', { r: 1 }, undefined, testDir)
      completeStep('task-final', 'step-two', { r: 2 }, undefined, testDir)
      const result = completeStep('task-final', 'step-three', { r: 3 }, undefined, testDir)
      expect(result.success).toBe(true)
      expect(result.workflowComplete).toBe(true)
      const instance = loadInstance('task-final', testDir)
      expect(instance!.status).toBe('complete')
    })

    it('returns error for non-in_progress step', () => {
      createInstance('task-nip', 'linear', testDir)
      const result = completeStep('task-nip', 'step-two', { r: 1 }, undefined, testDir)
      expect(result.success).toBe(false)
      expect(result.errors![0]).toContain('not in_progress')
    })
  })

  // ─── Linear workflow walk-through ───────────────────────────────────

  describe('linear workflow walk-through', () => {
    it('walks through 3 steps from start to finish', () => {
      createInstance('task-linear', 'linear', testDir)

      // Step 1
      let step = getCurrentStep('task-linear', undefined, testDir)
      expect((step as Record<string, unknown>).stepId).toBe('step-one')

      completeStep('task-linear', 'step-one', { data: 'one' }, undefined, testDir)

      // Step 2
      step = getCurrentStep('task-linear', undefined, testDir)
      expect((step as Record<string, unknown>).stepId).toBe('step-two')

      completeStep('task-linear', 'step-two', { data: 'two' }, undefined, testDir)

      // Step 3
      step = getCurrentStep('task-linear', undefined, testDir)
      expect((step as Record<string, unknown>).stepId).toBe('step-three')

      const result = completeStep('task-linear', 'step-three', { data: 'three' }, undefined, testDir)
      expect(result.workflowComplete).toBe(true)

      // Verify history
      const instance = loadInstance('task-linear', testDir)
      expect(instance!.history.length).toBe(3)
    })
  })

  // ─── Parallel group ─────────────────────────────────────────────────

  describe('parallel group', () => {
    it('dispatches all children when parallel group becomes active', () => {
      createInstance('task-par', 'parallel', testDir)
      completeStep('task-par', 'write-copy', { brief: 'test' }, undefined, testDir)

      const instance = loadInstance('task-par', testDir)
      expect(instance!.currentStepId).toBe('create-assets')
      expect(instance!.stepStates['create-image'].status).toBe('in_progress')
      expect(instance!.stepStates['create-video'].status).toBe('in_progress')
    })

    it('does not advance past group when only one child completes', () => {
      createInstance('task-par1', 'parallel', testDir)
      completeStep('task-par1', 'write-copy', { brief: 'test' }, undefined, testDir)
      completeStep('task-par1', 'create-image', { assetId: '20260401-img-a1b2c3d4' }, undefined, testDir)

      const instance = loadInstance('task-par1', testDir)
      expect(instance!.currentStepId).toBe('create-assets')
      expect(instance!.stepStates['publish'].status).toBe('pending')
    })

    it('advances past group when all children complete', () => {
      createInstance('task-par2', 'parallel', testDir)
      completeStep('task-par2', 'write-copy', { brief: 'test' }, undefined, testDir)
      completeStep('task-par2', 'create-image', { assetId: '20260401-img-a1b2c3d4' }, undefined, testDir)
      completeStep('task-par2', 'create-video', { video_filename: '20260401-vid-e5f6a7b8.mp4' }, undefined, testDir)

      const instance = loadInstance('task-par2', testDir)
      expect(instance!.currentStepId).toBe('publish')
      expect(instance!.stepStates['publish'].status).toBe('in_progress')
    })

    it('returns correct step for specific agent in parallel group', () => {
      createInstance('task-par3', 'parallel', testDir)
      completeStep('task-par3', 'write-copy', { brief: 'test' }, undefined, testDir)

      const pixelStep = getCurrentStep('task-par3', 'pixel', testDir)
      expect((pixelStep as Record<string, unknown>).stepId).toBe('create-image')

      const roloStep = getCurrentStep('task-par3', 'rolo', testDir)
      expect((roloStep as Record<string, unknown>).stepId).toBe('create-video')
    })

    it('does not leak a parallel sibling step to the wrong agent', () => {
      createInstance('task-par-wrong', 'parallel', testDir)
      completeStep('task-par-wrong', 'write-copy', { brief: 'test' }, undefined, testDir)

      expect(getCurrentStep('task-par-wrong', 'trainer', testDir)).toBeNull()
    })
  })

  // ─── Nested Workflows ───────────────────────────────────────────────

  describe('nested workflows', () => {
    const childWorkflow = `
name: Child Workflow
description: A child workflow for nesting tests
version: 1
steps:
  - id: child-step-1
    type: agent
    label: Child Step One
    agent: pixel
    description: Do child work
  - id: child-step-2
    type: agent
    label: Child Step Two
    agent: rolo
    description: Finish child work
`
    const parentWorkflow = `
name: Parent Workflow
description: A workflow that invokes a child workflow
version: 1
steps:
  - id: parent-step-1
    type: agent
    label: Parent Step One
    agent: chef
    description: Do parent work
  - id: nested-child
    type: workflow
    label: Run Child
    workflow_id: child-wf
  - id: parent-step-3
    type: agent
    label: Parent Step Three
    agent: chef
    description: Final parent step
`

    beforeEach(() => {
      writeFileSync(join(defsDir, 'child-wf.yaml'), childWorkflow)
      writeFileSync(join(defsDir, 'parent-wf.yaml'), parentWorkflow)
    })

    it('creates a child instance when workflow step is reached', () => {
      const parent = createInstance('task-nested', 'parent-wf', testDir)
      // Complete parent step 1 to advance to nested workflow step
      completeStep('task-nested', 'parent-step-1', { result: 'done' }, undefined, testDir)

      // Child instance should exist with synthetic taskId
      const child = loadInstance('task-nested--nested-child', testDir)
      expect(child).not.toBeNull()
      expect(child!.workflowId).toBe('child-wf')
      expect(child!.parentTaskId).toBe('task-nested')
      expect(child!.parentStepId).toBe('nested-child')
      expect(child!.status).toBe('in_progress')

      // Parent step should reference the child
      const parentReloaded = loadInstance('task-nested', testDir)
      expect(parentReloaded!.stepStates['nested-child'].childTaskId).toBe('task-nested--nested-child')
      expect(parentReloaded!.stepStates['nested-child'].status).toBe('in_progress')
    })

    it('delegates getCurrentStep to child instance', () => {
      createInstance('task-nested2', 'parent-wf', testDir)
      completeStep('task-nested2', 'parent-step-1', { result: 'done' }, undefined, testDir)

      // getCurrentStep on parent should return the child's current step
      const step = getCurrentStep('task-nested2', undefined, testDir) as Record<string, unknown>
      expect(step).not.toBeNull()
      expect(step.stepId).toBe('child-step-1')
      expect(step.agent).toBe('pixel')
    })

    it('delegates getActiveAgents to child instance', () => {
      createInstance('task-nested3', 'parent-wf', testDir)
      completeStep('task-nested3', 'parent-step-1', { result: 'done' }, undefined, testDir)

      const agents = getActiveAgents('task-nested3', testDir)
      expect(agents).toHaveLength(1)
      expect(agents[0].agent).toBe('pixel')
      expect(agents[0].stepId).toBe('child-step-1')
      expect(agents[0].effectiveTaskId).toBe('task-nested3--nested-child')
    })

    it('propagates child completion to parent and advances', () => {
      createInstance('task-nested4', 'parent-wf', testDir)
      completeStep('task-nested4', 'parent-step-1', { result: 'done' }, undefined, testDir)

      // Complete child steps
      completeStep('task-nested4--nested-child', 'child-step-1', { art: 'created' }, undefined, testDir)
      completeStep('task-nested4--nested-child', 'child-step-2', { video: 'done' }, undefined, testDir)

      // Child should be complete
      const child = loadInstance('task-nested4--nested-child', testDir)
      expect(child!.status).toBe('complete')

      // Parent should have advanced past the nested step
      const parent = loadInstance('task-nested4', testDir)
      expect(parent!.currentStepId).toBe('parent-step-3')
      expect(parent!.stepStates['nested-child'].status).toBe('complete')
      expect(parent!.stepStates['nested-child'].output).toBeDefined()

      // Parent's nested step output should contain child outputs + finalOutput
      const nestedOutput = parent!.stepStates['nested-child'].output as Record<string, unknown>
      expect(nestedOutput.childWorkflowId).toBe('child-wf')
      expect(nestedOutput.finalOutput).toEqual({ video: 'done' }) // last step's output promoted
      expect((nestedOutput.outputs as Record<string, unknown>)['child-step-1']).toEqual({ art: 'created' })
    })

    it('completes parent workflow when child is last-but-one step', () => {
      createInstance('task-nested5', 'parent-wf', testDir)
      completeStep('task-nested5', 'parent-step-1', { result: 'done' }, undefined, testDir)
      completeStep('task-nested5--nested-child', 'child-step-1', { art: 'created' }, undefined, testDir)
      completeStep('task-nested5--nested-child', 'child-step-2', { video: 'done' }, undefined, testDir)

      // Now complete parent step 3
      completeStep('task-nested5', 'parent-step-3', { final: 'published' }, undefined, testDir)
      const parent = loadInstance('task-nested5', testDir)
      expect(parent!.status).toBe('complete')
    })

    it('inherits resolvedAgent from parent to child', () => {
      createInstance('task-nested6', 'parent-wf', testDir, 'explorer')
      completeStep('task-nested6', 'parent-step-1', { result: 'done' }, undefined, testDir)

      const child = loadInstance('task-nested6--nested-child', testDir)
      expect(child!.resolvedAgent).toBe('explorer')
    })

    it('cancels child instances when parent is cancelled', () => {
      createInstance('task-nested7', 'parent-wf', testDir)
      completeStep('task-nested7', 'parent-step-1', { result: 'done' }, undefined, testDir)

      // Child should be active
      const child = loadInstance('task-nested7--nested-child', testDir)
      expect(child!.status).toBe('in_progress')

      // Cancel the parent
      cancelInstance('task-nested7', testDir)

      const parentAfter = loadInstance('task-nested7', testDir)
      expect(parentAfter!.status).toBe('cancelled')

      const childAfter = loadInstance('task-nested7--nested-child', testDir)
      expect(childAfter!.status).toBe('cancelled')
    })

    it('getCurrentStep returns status cancelled for cancelled instances — honest terminal, not a false complete (#604 T6)', () => {
      createInstance('task-nested8', 'parent-wf', testDir)
      cancelInstance('task-nested8', testDir)
      expect(getCurrentStep('task-nested8', undefined, testDir)).toEqual({ status: 'cancelled' })
    })

    it('completeStep refuses submissions against a cancelled instance (#604 review F1)', () => {
      createInstance('task-cancelled-submit', 'linear', testDir)
      cancelInstance('task-cancelled-submit', testDir)
      const result = completeStep('task-cancelled-submit', 'step-one', { result: 'late output' }, undefined, testDir)
      expect(result.success).toBe(false)
      expect(result.errors?.[0]).toContain('cancelled')
    })

    it('getActiveAgents returns empty for cancelled instances', () => {
      createInstance('task-nested9', 'parent-wf', testDir)
      cancelInstance('task-nested9', testDir)
      const agents = getActiveAgents('task-nested9', testDir)
      expect(agents).toHaveLength(0)
    })

    // Regression: the watchdog recovery path can re-run createInstance/
    // advanceWorkflow for an already-active workflow, which previously
    // called createTask on the child board row a second time, creating
    // duplicate "Run Child (sub-workflow)" cards. createBoardTaskForChild
    // now guards on getTask(childTaskId) to make the retry a no-op.
    it('createBoardTaskForChild is idempotent across retries', async () => {
      // parent-first-nested has a nested workflow as its FIRST step so
      // createInstance() triggers createBoardTaskForChild directly (the
      // simplest path to exercise the idempotency guard).
      writeFileSync(join(defsDir, 'parent-first-nested.yaml'), `
name: Parent First Nested
description: Parent whose first step is a nested child workflow
version: 1
steps:
  - id: nested-child
    type: workflow
    label: Run Child
    workflow_id: child-wf
`)

      createInstance('task-retry', 'parent-first-nested', testDir)
      await vi.waitFor(() => expect(hookTasks.has('task-retry--nested-child')).toBe(true))
      const firstCallCount = createTaskHook.mock.calls.length
      expect(firstCallCount).toBeGreaterThanOrEqual(1)

      // Simulate watchdog re-dispatch: createInstance overwrites the parent
      // instance and re-enters the nested-first-step spawn path. Without
      // the guard this would call createTask a second time.
      createInstance('task-retry', 'parent-first-nested', testDir)
      // Drain any pending microtasks from the second createInstance so a
      // duplicate createTask would have time to land before we assert.
      await new Promise(resolve => setImmediate(resolve))

      const secondCallCount = createTaskHook.mock.calls.length
      expect(secondCallCount).toBe(firstCallCount)
    })
  })
})
