import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-runtime-${Date.now()}`)

// ─── CRITICAL: Mock content-dir to prevent writes to ~/.bakin/ ─────────────
vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: vi.fn(),
  initBakinHome: vi.fn(),
  isUsingBakinHome: () => false,
}))

// Mock audit to prevent writes to audit.jsonl
vi.mock('../../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

// Mock logger to prevent noise
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock flow-store so tests don't leak child-workflow tasks into the real board.
// The path needs three `../` to reach the repo root — two would land in tests/
// and the mock would silently no-op, letting the real module write to
// ~/.openclaw/flows/registry.sqlite.
vi.mock('../../../plugins/tasks/lib/flow-store', () => ({
  createTask: vi.fn(() => Promise.resolve({ id: 'mock-task' })),
  addTaskLog: vi.fn(() => Promise.resolve()),
  moveTask: vi.fn(() => Promise.resolve()),
  readTaskboard: vi.fn(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: vi.fn(() => null),
  getTaskWithColumn: vi.fn(() => null),
}))

// Defense-in-depth: even if another module reaches openclaw-home, redirect it
// into testDir instead of ~/.openclaw/.
vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => testDir,
  getOpenClawPath: (...parts: string[]) => join(testDir, ...parts),
  resetOpenClawHome: vi.fn(),
}))

import {
  createInstance,
  loadInstance,
  getCurrentStep,
  completeStep,
  approveGate,
  rejectGate,
  listInstances,
  getActiveAgents,
  cancelInstance,
} from '@bakin/workflows/lib/runtime'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'

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
    agent: basil
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
    agent: basil
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

  // Workflow with gate step
  const gateWorkflow = `
name: Gate Test
description: Workflow with gate
version: 1
steps:
  - id: write-copy
    type: agent
    label: Write Copy
    agent: basil
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
    agent: basil
    skill: test-skill
  - id: plain
    type: agent
    label: Plain
    agent: pixel
    description: No skill, just description
`

  beforeEach(() => {
    invalidateSkillCache()
    mkdirSync(defsDir, { recursive: true })
    mkdirSync(skillsDir, { recursive: true })
    mkdirSync(instancesDir, { recursive: true })

    writeFileSync(join(defsDir, 'linear.yaml'), linearWorkflow)
    writeFileSync(join(defsDir, 'parallel.yaml'), parallelWorkflow)
    writeFileSync(join(defsDir, 'gate.yaml'), gateWorkflow)
    writeFileSync(join(defsDir, 'skill-test.yaml'), skillWorkflow)

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

    it('persists the instance to disk', () => {
      const instance = createInstance('task-2', 'linear', testDir)
      const loaded = loadInstance('task-2', testDir)
      expect(loaded).not.toBeNull()
      expect(loaded!.instanceId).toBe(instance.instanceId)
    })

    it('throws for unknown workflow definition', () => {
      expect(() => createInstance('task-x', 'nonexistent', testDir)).toThrow()
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
      completeStep('task-par1', 'create-image', { image_path: '/img.png' }, undefined, testDir)

      const instance = loadInstance('task-par1', testDir)
      expect(instance!.currentStepId).toBe('create-assets')
      expect(instance!.stepStates['publish'].status).toBe('pending')
    })

    it('advances past group when all children complete', () => {
      createInstance('task-par2', 'parallel', testDir)
      completeStep('task-par2', 'write-copy', { brief: 'test' }, undefined, testDir)
      completeStep('task-par2', 'create-image', { image_path: '/img.png' }, undefined, testDir)
      completeStep('task-par2', 'create-video', { video_path: '/vid.mp4' }, undefined, testDir)

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
  })

  // ─── Gate operations ────────────────────────────────────────────────

  describe('gate operations', () => {
    it('approveGate advances past gate to next step', () => {
      createInstance('task-gate-a', 'gate', testDir)
      completeStep('task-gate-a', 'write-copy', { text: 'hello' }, undefined, testDir)

      const approveResult = approveGate('task-gate-a', 'review-gate', testDir)
      expect(approveResult.success).toBe(true)

      const instance = loadInstance('task-gate-a', testDir)
      expect(instance!.currentStepId).toBe('publish')
      expect(instance!.status).toBe('in_progress')
    })

    it('rejectGate rewinds to target step', () => {
      createInstance('task-gate-r', 'gate', testDir)
      completeStep('task-gate-r', 'write-copy', { text: 'hello' }, undefined, testDir)

      const rejectResult = rejectGate('task-gate-r', 'review-gate', 'Not good enough', undefined, testDir)
      expect(rejectResult.success).toBe(true)
      expect(rejectResult.rewoundTo).toBe('write-copy')

      const instance = loadInstance('task-gate-r', testDir)
      expect(instance!.currentStepId).toBe('write-copy')
      expect(instance!.stepStates['write-copy'].status).toBe('in_progress')
    })

    it('rejectGate with note_to_agent includes reason in step context', () => {
      createInstance('task-gate-n', 'gate', testDir)
      completeStep('task-gate-n', 'write-copy', { text: 'hello' }, undefined, testDir)

      rejectGate('task-gate-n', 'review-gate', 'Caption too long', undefined, testDir)

      const instance = loadInstance('task-gate-n', testDir)
      expect(instance!.stepStates['write-copy'].rejectionReason).toBe('Caption too long')

      const step = getCurrentStep('task-gate-n', undefined, testDir)
      expect((step as Record<string, unknown>).rejectionReason).toBe('Caption too long')
    })

    it('returns error when approving non-gate step', () => {
      createInstance('task-gate-bad', 'linear', testDir)
      const result = approveGate('task-gate-bad', 'step-one', testDir)
      expect(result.success).toBe(false)
      expect(result.errors![0]).toContain('not a gate')
    })

    it('returns error when gate is not pending_approval', () => {
      createInstance('task-gate-np', 'gate', testDir)
      // Gate is still pending (not reached yet)
      const result = approveGate('task-gate-np', 'review-gate', testDir)
      expect(result.success).toBe(false)
    })
  })

  // ─── Rewind ─────────────────────────────────────────────────────────

  describe('rewind', () => {
    it('resets rewound step to in_progress and all steps after to pending', () => {
      createInstance('task-rew', 'gate', testDir)
      completeStep('task-rew', 'write-copy', { text: 'hello' }, undefined, testDir)

      rejectGate('task-rew', 'review-gate', 'redo it', undefined, testDir)

      const instance = loadInstance('task-rew', testDir)
      expect(instance!.stepStates['write-copy'].status).toBe('in_progress')
      expect(instance!.stepStates['review-gate'].status).toBe('pending')
      expect(instance!.stepStates['publish'].status).toBe('pending')
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
      expect(agents[0].agent).toBe('basil')
    })

    it('returns multiple agents for parallel step', () => {
      createInstance('task-agents-par', 'parallel', testDir)
      completeStep('task-agents-par', 'write-copy', { brief: 'x' }, undefined, testDir)
      const agents = getActiveAgents('task-agents-par', testDir)
      expect(agents.length).toBe(2)
      expect(agents.map(a => a.agent).sort()).toEqual(['pixel', 'rolo'])
    })
  })

  // ─── Agent-scoping on step/complete ─────────────────────────────────

  describe('agent-scoping', () => {
    it('allows the assigned agent to complete their step', () => {
      createInstance('task-scope-ok', 'linear', testDir)
      const result = completeStep('task-scope-ok', 'step-one', { data: 'done' }, 'basil', testDir)
      expect(result.success).toBe(true)
    })

    it('rejects a different agent completing a step not assigned to them', () => {
      createInstance('task-scope-bad', 'linear', testDir)
      const result = completeStep('task-scope-bad', 'step-one', { data: 'done' }, 'pixel', testDir)
      expect(result.success).toBe(false)
      expect(result.errors![0]).toContain('assigned to "basil"')
      expect(result.errors![0]).toContain('"pixel"')
    })

    it('rejects orchestrator completing a subagent step', () => {
      createInstance('task-scope-orch', 'linear', testDir)
      const result = completeStep('task-scope-orch', 'step-one', { data: 'done' }, 'main', testDir)
      expect(result.success).toBe(false)
      expect(result.errors![0]).toContain('assigned to "basil"')
    })

    it('skips agent-scoping when callerAgentId is undefined (backwards compat)', () => {
      createInstance('task-scope-undef', 'linear', testDir)
      const result = completeStep('task-scope-undef', 'step-one', { data: 'done' }, undefined, testDir)
      expect(result.success).toBe(true)
    })
  })

  // ─── previousOutput on rejection ────────────────────────────────────

  describe('previousOutput on rejection', () => {
    it('preserves previousOutput when gate rejects and rewinds', () => {
      createInstance('task-prev', 'gate', testDir)
      completeStep('task-prev', 'write-copy', { text: 'original work' }, undefined, testDir)

      // Gate is pending_approval — reject it
      rejectGate('task-prev', 'review-gate', 'Too short', undefined, testDir)

      const instance = loadInstance('task-prev', testDir)
      expect(instance!.stepStates['write-copy'].previousOutput).toEqual({ text: 'original work' })
    })

    it('passes previousOutput through getCurrentStep context', () => {
      createInstance('task-prev-ctx', 'gate', testDir)
      completeStep('task-prev-ctx', 'write-copy', { text: 'original work' }, undefined, testDir)
      rejectGate('task-prev-ctx', 'review-gate', 'Redo it', undefined, testDir)

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
    agent: basil
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
    agent: basil
    description: Do parent work
  - id: nested-child
    type: workflow
    label: Run Child
    workflow_id: child-wf
  - id: parent-step-3
    type: agent
    label: Parent Step Three
    agent: basil
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
      createInstance('task-nested6', 'parent-wf', testDir, 'scout')
      completeStep('task-nested6', 'parent-step-1', { result: 'done' }, undefined, testDir)

      const child = loadInstance('task-nested6--nested-child', testDir)
      expect(child!.resolvedAgent).toBe('scout')
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

      // Stateful mock: track which ids have been "created" on the board
      // so getTask(id) returns truthy after createTask has been called.
      const flowStore = await import('../../../plugins/tasks/lib/flow-store')
      const createdIds = new Set<string>()
      vi.mocked(flowStore.createTask).mockImplementation(
        // Positional signature: (title, column, assignee, description, workflowId, createdBy, id, parentId, projectId)
        (((...args: unknown[]) => {
          const id = (args[6] as string) ?? 'mock-task'
          createdIds.add(id)
          return Promise.resolve({ id } as unknown)
        }) as unknown) as typeof flowStore.createTask,
      )
      vi.mocked(flowStore.getTask).mockImplementation(
        (id: string) => (createdIds.has(id) ? ({ id, title: 'stub' } as unknown as ReturnType<typeof flowStore.getTask>) : null),
      )

      // Wait for the async import chain inside createBoardTaskForChild to settle.
      // Dynamic import + .then().then() needs real tick flushing, not just
      // microtasks — setTimeout(0) runs after the entire microtask queue drains.
      async function flushAsync() {
        await new Promise(resolve => setTimeout(resolve, 20))
      }

      createInstance('task-retry', 'parent-first-nested', testDir)
      await flushAsync()
      expect(createdIds.has('task-retry--nested-child')).toBe(true)
      const firstCallCount = vi.mocked(flowStore.createTask).mock.calls.length
      expect(firstCallCount).toBeGreaterThanOrEqual(1)

      // Simulate watchdog re-dispatch: createInstance overwrites the parent
      // instance and re-enters the nested-first-step spawn path. Without
      // the guard this would call createTask a second time.
      createInstance('task-retry', 'parent-first-nested', testDir)
      await flushAsync()

      const secondCallCount = vi.mocked(flowStore.createTask).mock.calls.length
      expect(secondCallCount).toBe(firstCallCount)
    })
  })
})
