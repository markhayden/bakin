import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-runtime-${Date.now()}`)

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

type HookTask = { id: string; title: string; column: string; description?: string }
const hookTasks = new Map<string, HookTask>()
const createTaskHook = mock(async (data: Record<string, unknown>) => {
  const id = data.id as string
  hookTasks.set(id, {
    id,
    title: data.title as string,
    column: data.column as string,
    description: data.description as string | undefined,
  })
  return { id }
})
const createTaskWithEffectsHook = mock(async (data: Record<string, unknown>) => {
  const id = data.id as string
  hookTasks.set(id, {
    id,
    title: data.title as string,
    column: data.column as string,
    description: data.description as string | undefined,
  })
  return { id, workflowId: data.workflowId as string | undefined }
})
const addTaskLogHook = mock(async (_data?: Record<string, unknown>) => undefined)
const moveTaskHook = mock(async (data: Record<string, unknown>) => {
  const task = hookTasks.get(data.identifier as string)
  if (task) task.column = data.to as string
})
// Ledger-sync seam (#482): the runtime's store moves must go through
// task-service's syncLedgerForStoreMove. The spy delegates to moveTaskHook so
// move-sequence assertions keep observing the same store calls.
const syncLedgerForStoreMoveHook = mock(async (taskId: string, to: string, _agent: string, opts?: { from?: string }) => {
  await moveTaskHook({ identifier: taskId, to, from: opts?.from })
})

function readTaskboardForTest() {
  const columns: Record<string, HookTask[]> = {
    backlog: [],
    inProgress: [],
    todo: [],
    review: [],
    done: [],
    archived: [],
    blocked: [],
  }
  for (const task of hookTasks.values()) {
    ;(columns[task.column] ??= []).push(task)
  }
  return { columns }
}

const taskStoreMock = {
  addTaskLog: (identifier: string, author: string, message: string) => addTaskLogHook({ identifier, author, message }),
  createTask: (
    title: string,
    column?: string,
    _assignee?: string,
    description?: string,
    _workflowId?: string,
    _createdBy?: string,
    id?: string,
  ) => createTaskHook({ id, title, column, description }),
  getTask: (id: string) => hookTasks.get(id) ?? null,
  getTaskWithColumn: (id: string) => {
    const task = hookTasks.get(id)
    return task ? { task, column: task.column } : null
  },
  moveTask: (identifier: string, to: string, from?: string) => moveTaskHook({ identifier, to, from }),
  readTaskboard: readTaskboardForTest,
}

mock.module('../../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

const taskServiceMock = () => ({
  createTaskWithEffects: (data: Record<string, unknown>) => createTaskWithEffectsHook(data),
  syncLedgerForStoreMove: (taskId: string, to: string, agent: string, opts?: { from?: string }) =>
    syncLedgerForStoreMoveHook(taskId, to, agent, opts),
})
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
  approveGate,
  rejectGate,
  reopenFromStep,
  listInstances,
  getActiveAgents,
  authorizeWorkflowToolUse,
  cancelInstance,
} from '@bakin/workflows/lib/runtime'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import { setEventBus } from '@bakin/workflows/lib/notifications'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'

describe('runtime', () => {
  const defsDir = join(testDir, 'workflows', 'definitions')
  const skillsDir = join(testDir, 'workflows', 'skills')
  const instancesDir = join(testDir, 'workflows', 'instances')

  // Simple linear workflow: 3 agent steps
  const linearWorkflow = `
name: Linear Test
description: 3-step linear workflow
version: 1
steps:
  - id: step-one
    type: agent
    label: Step One
    agent: chef
    description: Do step one
  - id: step-two
    type: agent
    label: Step Two
    agent: pixel
    description: Do step two
  - id: step-three
    type: agent
    label: Step Three
    agent: rolo
    description: Do step three
`

  // Workflow with parallel steps
  const parallelWorkflow = `
name: Parallel Test
description: Workflow with parallel steps
version: 1
steps:
  - id: write-copy
    type: agent
    label: Write Copy
    agent: chef
    description: Write the copy
  - id: create-assets
    type: parallel
    label: Generate Assets
    steps:
      - id: create-image
        type: agent
        label: Generate Image
        agent: pixel
        description: Generate an image
      - id: create-video
        type: agent
        label: Generate Video
        agent: rolo
        description: Generate a video
  - id: publish
    type: agent
    label: Publish
    agent: main
    description: Publish it all
`

  const preferredWorkflow = `
name: Preferred Agent Test
description: Prefer pixel with assigned fallback
version: 1
steps:
  - id: create-image
    type: agent
    label: Create Image
    agent: $preferred(pixel,$assigned)
    description: Create the image
`

  // Workflow with gate step
  const gateWorkflow = `
name: Gate Test
description: Workflow with gate
version: 1
steps:
  - id: write-copy
    type: agent
    label: Write Copy
    agent: chef
    description: Write the copy
  - id: review-gate
    type: gate
    label: Review
    description: Human review
    approval_required: true
    on_approve: publish
    on_reject:
      goto: write-copy
      note_to_agent: true
  - id: publish
    type: agent
    label: Publish
    agent: main
    description: Publish
`

  // Workflow with skill references
  const skillWorkflow = `
name: Skill Test
description: Test skill resolution
version: 1
steps:
  - id: write
    type: agent
    label: Write
    agent: chef
    skill: test-skill
  - id: plain
    type: agent
    label: Plain
    agent: pixel
    description: No skill, just description
`

  beforeEach(() => {
    invalidateSkillCache()
    hookTasks.clear()
    createTaskHook.mockClear()
    createTaskWithEffectsHook.mockClear()
    addTaskLogHook.mockClear()
    moveTaskHook.mockClear()
    mkdirSync(defsDir, { recursive: true })
    mkdirSync(skillsDir, { recursive: true })
    mkdirSync(instancesDir, { recursive: true })

    writeFileSync(join(defsDir, 'linear.yaml'), linearWorkflow)
    writeFileSync(join(defsDir, 'parallel.yaml'), parallelWorkflow)
    writeFileSync(join(defsDir, 'preferred.yaml'), preferredWorkflow)
    writeFileSync(join(defsDir, 'gate.yaml'), gateWorkflow)
    writeFileSync(join(defsDir, 'skill-test.yaml'), skillWorkflow)
    writeFileSync(join(defsDir, 'task-node.yaml'), `
name: Task Node Test
description: Builtin createTask node
version: 1
steps:
  - id: make-task
    type: createTask
    label: Make Task
    title: Prep Instagram Reel
    agent: patch
    description: Prepare the channel deliverable.
    availableAt: '2026-05-18T15:00:00.000Z'
    dueAt: '2026-05-22T15:00:00.000Z'
    source:
      pluginId: messaging
      entityType: deliverable
      entityId: deliverable-1
      purpose: kickoff
  - id: after-create
    type: agent
    label: Continue
    agent: chef
    description: Continue after task creation
`)

    writeFileSync(join(skillsDir, 'test-skill.md'), `---
name: Test Skill
output_schema:
  type: object
  required:
    - caption
  properties:
    caption:
      type: string
---

Write a great caption.
`)
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
      await new Promise(resolve => setTimeout(resolve, 0))

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
      await new Promise(resolve => setTimeout(resolve, 0))

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

  // ─── getCurrentStep ─────────────────────────────────────────────────

  describe('getCurrentStep', () => {
    it('returns only current step context, never future steps', () => {
      createInstance('task-3', 'linear', testDir)
      const step = getCurrentStep('task-3', undefined, testDir)
      expect(step).not.toBeNull()
      expect((step as Record<string, unknown>).stepId).toBe('step-one')
      expect((step as Record<string, unknown>).instructions).toBe('Do step one')
    })

    it('returns blocked status when at a gate with pending_approval', () => {
      createInstance('task-gate', 'gate', testDir)
      // Complete the first step
      completeStep('task-gate', 'write-copy', { result: 'done' }, undefined, testDir)
      const step = getCurrentStep('task-gate', undefined, testDir)
      expect(step).not.toBeNull()
      expect((step as Record<string, unknown>).status).toBe('pending_approval')
    })

    it('returns pending approval gate status for agent-scoped lookups', () => {
      createInstance('task-gate-agent', 'gate', testDir)
      completeStep('task-gate-agent', 'write-copy', { result: 'done' }, 'chef', testDir)

      const step = getCurrentStep('task-gate-agent', 'chef', testDir)

      expect(step).toMatchObject({
        status: 'pending_approval',
        stepId: 'review-gate',
        label: 'Review',
      })
    })

    it('returns completion status when workflow is done', () => {
      createInstance('task-done', 'linear', testDir)
      completeStep('task-done', 'step-one', { result: 'a' }, undefined, testDir)
      completeStep('task-done', 'step-two', { result: 'b' }, undefined, testDir)
      completeStep('task-done', 'step-three', { result: 'c' }, undefined, testDir)
      const step = getCurrentStep('task-done', undefined, testDir)
      expect((step as Record<string, unknown>).status).toBe('complete')
    })

    it('returns null for unknown task', () => {
      expect(getCurrentStep('nonexistent', undefined, testDir)).toBeNull()
    })
  })

  // ─── completeStep ───────────────────────────────────────────────────

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
      await new Promise(resolve => setTimeout(resolve, 0))

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
      await new Promise(resolve => setTimeout(resolve, 0))

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

  // ─── Gate operations ────────────────────────────────────────────────

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

      // Wait briefly so durationMs is non-zero
      await new Promise(r => setTimeout(r, 5))

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

      await new Promise(resolve => setTimeout(resolve, 0))
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

  // ─── Ledger sync wiring (#482) ─────────────────────────────────────

  describe('ledger sync wiring', () => {
    it('workflow completion lands the task on done through the ledger-sync helper', async () => {
      createInstance('task-ledger-done', 'linear', testDir)
      completeStep('task-ledger-done', 'step-one', { r: 1 }, undefined, testDir)
      completeStep('task-ledger-done', 'step-two', { r: 2 }, undefined, testDir)
      completeStep('task-ledger-done', 'step-three', { r: 3 }, undefined, testDir)

      await new Promise(resolve => setTimeout(resolve, 0))
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

      await new Promise(resolve => setTimeout(resolve, 0))
      expect(syncLedgerForStoreMoveHook).toHaveBeenCalledWith(
        'task-ledger-reopen', 'inProgress', 'workflow', expect.anything(),
      )
    })
  })

  // ─── Skill resolution ──────────────────────────────────────────────

  describe('skill resolution', () => {
    it('loads skill instructions and output_schema for step with skill field', () => {
      createInstance('task-skill', 'skill-test', testDir)
      const step = getCurrentStep('task-skill', undefined, testDir) as Record<string, unknown>
      expect(step.instructions).toContain('Write a great caption')
      expect(step.output_schema).toBeDefined()
    })

    it('uses description for step without skill field', () => {
      createInstance('task-skill-plain', 'skill-test', testDir)
      completeStep('task-skill-plain', 'write', { caption: 'test' }, undefined, testDir)
      const step = getCurrentStep('task-skill-plain', undefined, testDir) as Record<string, unknown>
      expect(step.stepId).toBe('plain')
      expect(step.instructions).toBe('No skill, just description')
    })
  })

  // ─── Instance persistence ──────────────────────────────────────────

  describe('instance persistence', () => {
    it('creates and reads JSON files from directory', () => {
      const instance = createInstance('task-persist', 'linear', testDir)
      expect(existsSync(join(instancesDir, 'task-persist.json'))).toBe(true)

      const loaded = loadInstance('task-persist', testDir)
      expect(loaded!.instanceId).toBe(instance.instanceId)
      expect(loaded!.workflowId).toBe('linear')
    })
  })

  // ─── listInstances ─────────────────────────────────────────────────

  describe('listInstances', () => {
    it('lists all instances', () => {
      createInstance('t1', 'linear', testDir)
      createInstance('t2', 'linear', testDir)
      const all = listInstances(undefined, testDir)
      expect(all.length).toBe(2)
    })

    it('filters by status', () => {
      createInstance('t3', 'linear', testDir)
      createInstance('t4', 'linear', testDir)
      // Complete t4
      completeStep('t4', 'step-one', { r: 1 }, undefined, testDir)
      completeStep('t4', 'step-two', { r: 2 }, undefined, testDir)
      completeStep('t4', 'step-three', { r: 3 }, undefined, testDir)

      const inProgress = listInstances('in_progress', testDir)
      expect(inProgress.length).toBe(1)
      expect(inProgress[0].taskId).toBe('t3')
    })
  })

  // ─── getActiveAgents ───────────────────────────────────────────────

  describe('getActiveAgents', () => {
    it('returns single agent for linear step', () => {
      createInstance('task-agents', 'linear', testDir)
      const agents = getActiveAgents('task-agents', testDir)
      expect(agents.length).toBe(1)
      expect(agents[0].agent).toBe('chef')
    })

    it('returns multiple agents for parallel step', () => {
      createInstance('task-agents-par', 'parallel', testDir)
      completeStep('task-agents-par', 'write-copy', { brief: 'x' }, undefined, testDir)
      const agents = getActiveAgents('task-agents-par', testDir)
      expect(agents.length).toBe(2)
      expect(agents.map(a => a.agent).sort()).toEqual(['pixel', 'rolo'])
    })

    it('uses the preferred agent when available in the workflow snapshot', () => {
      createInstance('task-preferred-pixel', 'preferred', testDir, 'main', undefined, ['main', 'pixel'])
      const agents = getActiveAgents('task-preferred-pixel', testDir)
      expect(agents).toEqual([{ agent: 'pixel', stepId: 'create-image' }])
    })

    it('falls back to the assigned agent when the preferred agent is unavailable', () => {
      createInstance('task-preferred-assigned', 'preferred', testDir, 'main', undefined, ['main'])
      const agents = getActiveAgents('task-preferred-assigned', testDir)
      expect(agents).toEqual([{ agent: 'main', stepId: 'create-image' }])
    })

    it('resolves the named preferred agent when no availableAgents snapshot exists', () => {
      // Instances rehydrated from disk that predate the snapshot have
      // availableAgents === undefined. The named choice must still resolve
      // (best-effort) rather than dropping the step owner — otherwise
      // preferred routing degrades AND the agent-scoping guard is bypassed.
      createInstance('task-preferred-nosnapshot', 'preferred', testDir, 'main')
      const agents = getActiveAgents('task-preferred-nosnapshot', testDir)
      expect(agents).toEqual([{ agent: 'pixel', stepId: 'create-image' }])
    })
  })

  // ─── Agent-scoping on step/complete ─────────────────────────────────

  describe('agent-scoping', () => {
    it('allows the assigned agent to complete their step', () => {
      createInstance('task-scope-ok', 'linear', testDir)
      const result = completeStep('task-scope-ok', 'step-one', { data: 'done' }, 'chef', testDir)
      expect(result.success).toBe(true)
    })

    it('rejects a different agent completing a step not assigned to them', () => {
      createInstance('task-scope-bad', 'linear', testDir)
      const result = completeStep('task-scope-bad', 'step-one', { data: 'done' }, 'pixel', testDir)
      expect(result.success).toBe(false)
      expect(result.errors![0]).toContain('assigned to "chef"')
      expect(result.errors![0]).toContain('"pixel"')
    })

    it('rejects orchestrator completing a subagent step', () => {
      createInstance('task-scope-orch', 'linear', testDir)
      const result = completeStep('task-scope-orch', 'step-one', { data: 'done' }, 'main', testDir)
      expect(result.success).toBe(false)
      expect(result.errors![0]).toContain('assigned to "chef"')
    })

    it('skips agent-scoping when callerAgentId is undefined (backwards compat)', () => {
      createInstance('task-scope-undef', 'linear', testDir)
      const result = completeStep('task-scope-undef', 'step-one', { data: 'done' }, undefined, testDir)
      expect(result.success).toBe(true)
    })

    it('does not return a linear step to a non-owner agent', () => {
      createInstance('task-step-scope-bad', 'linear', testDir)
      expect(getCurrentStep('task-step-scope-bad', 'pixel', testDir)).toBeNull()
    })

    it('authorizes progress logs only for the current owner', () => {
      createInstance('task-auth-log', 'linear', testDir)

      expect(authorizeWorkflowToolUse('task-auth-log', 'chef', 'progress-log', testDir).allowed).toBe(true)
      const denied = authorizeWorkflowToolUse('task-auth-log', 'pixel', 'progress-log', testDir)
      expect(denied.allowed).toBe(false)
      expect(denied.reason).toContain('not the owner')
    })

    it('allows channel posts only from active output steps', () => {
      writeFileSync(join(defsDir, 'output-flow.yaml'), `
name: Output Flow
description: Output step auth
version: 1
steps:
  - id: write
    type: agent
    label: Write
    agent: chef
  - id: publish
    type: output
    label: Publish
    agent: chef
`)
      createInstance('task-auth-post', 'output-flow', testDir)

      const early = authorizeWorkflowToolUse('task-auth-post', 'chef', 'channel-post', testDir)
      expect(early.allowed).toBe(false)
      expect(early.reason).toContain('only allowed from the active output step')

      completeStep('task-auth-post', 'write', { text: 'ready' }, 'chef', testDir)
      expect(authorizeWorkflowToolUse('task-auth-post', 'chef', 'channel-post', testDir).allowed).toBe(true)
    })

    it('denies task completion while a workflow is active', () => {
      createInstance('task-auth-complete', 'linear', testDir)

      const denied = authorizeWorkflowToolUse('task-auth-complete', 'chef', 'task-complete', testDir)
      expect(denied.allowed).toBe(false)
      expect(denied.reason).toContain('workflow engine complete')
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

  // ─── deny_tools in StepContext ──────────────────────────────────────

  describe('deny_tools', () => {
    const denyToolsWorkflow = `
name: Deny Tools Test
description: Test deny_tools flow
version: 1
steps:
  - id: write
    type: agent
    label: Write Copy
    agent: chef
    description: Write the copy
    deny_tools:
      - image_generation
      - video_generation
  - id: review
    type: agent
    label: Review
    agent: main
    description: Review it
`

    it('includes deny_tools in step context', () => {
      writeFileSync(join(defsDir, 'deny-tools.yaml'), denyToolsWorkflow)
      createInstance('task-deny', 'deny-tools', testDir)
      const step = getCurrentStep('task-deny', undefined, testDir) as Record<string, unknown>
      expect(step.deny_tools).toEqual(['image_generation', 'video_generation'])
    })

    it('does not include deny_tools when not defined on step', () => {
      writeFileSync(join(defsDir, 'deny-tools.yaml'), denyToolsWorkflow)
      createInstance('task-deny2', 'deny-tools', testDir)
      completeStep('task-deny2', 'write', { data: 'done' }, undefined, testDir)
      const step = getCurrentStep('task-deny2', undefined, testDir) as Record<string, unknown>
      expect(step.deny_tools).toBeUndefined()
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

    it('getCurrentStep returns complete for cancelled instances', () => {
      createInstance('task-nested8', 'parent-wf', testDir)
      cancelInstance('task-nested8', testDir)
      const step = getCurrentStep('task-nested8', undefined, testDir) as { status: string }
      expect(step.status).toBe('complete')
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
