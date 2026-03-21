import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createInstance,
  loadInstance,
  getCurrentStep,
  completeStep,
  approveGate,
  rejectGate,
  listInstances,
  getActiveAgents,
} from '@mc/workflows/runtime'
import { invalidateSkillCache } from '@mc/workflows/skill-loader'

describe('runtime', () => {
  const testDir = join(tmpdir(), `beacon-test-runtime-${Date.now()}`)
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
    agent: roscoe
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
    agent: roscoe
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
      completeStep('task-gate', 'write-copy', { result: 'done' }, testDir)
      const step = getCurrentStep('task-gate', undefined, testDir)
      expect(step).not.toBeNull()
      expect((step as Record<string, unknown>).status).toBe('pending_approval')
    })

    it('returns completion status when workflow is done', () => {
      createInstance('task-done', 'linear', testDir)
      completeStep('task-done', 'step-one', { result: 'a' }, testDir)
      completeStep('task-done', 'step-two', { result: 'b' }, testDir)
      completeStep('task-done', 'step-three', { result: 'c' }, testDir)
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
      const result = completeStep('task-adv', 'step-one', { result: 'done' }, testDir)
      expect(result.success).toBe(true)
      const instance = loadInstance('task-adv', testDir)
      expect(instance!.currentStepId).toBe('step-two')
      expect(instance!.stepStates['step-one'].status).toBe('complete')
      expect(instance!.stepStates['step-two'].status).toBe('in_progress')
    })

    it('rejects invalid output and does not advance', () => {
      createInstance('task-schema', 'skill-test', testDir)
      // Step 'write' has a skill with output_schema requiring caption: string
      const result = completeStep('task-schema', 'write', {}, testDir)
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      const instance = loadInstance('task-schema', testDir)
      expect(instance!.currentStepId).toBe('write')
    })

    it('marks workflow complete on final step', () => {
      createInstance('task-final', 'linear', testDir)
      completeStep('task-final', 'step-one', { r: 1 }, testDir)
      completeStep('task-final', 'step-two', { r: 2 }, testDir)
      const result = completeStep('task-final', 'step-three', { r: 3 }, testDir)
      expect(result.success).toBe(true)
      expect(result.workflowComplete).toBe(true)
      const instance = loadInstance('task-final', testDir)
      expect(instance!.status).toBe('complete')
    })

    it('returns error for non-in_progress step', () => {
      createInstance('task-nip', 'linear', testDir)
      const result = completeStep('task-nip', 'step-two', { r: 1 }, testDir)
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

      completeStep('task-linear', 'step-one', { data: 'one' }, testDir)

      // Step 2
      step = getCurrentStep('task-linear', undefined, testDir)
      expect((step as Record<string, unknown>).stepId).toBe('step-two')

      completeStep('task-linear', 'step-two', { data: 'two' }, testDir)

      // Step 3
      step = getCurrentStep('task-linear', undefined, testDir)
      expect((step as Record<string, unknown>).stepId).toBe('step-three')

      const result = completeStep('task-linear', 'step-three', { data: 'three' }, testDir)
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
      completeStep('task-par', 'write-copy', { brief: 'test' }, testDir)

      const instance = loadInstance('task-par', testDir)
      expect(instance!.currentStepId).toBe('create-assets')
      expect(instance!.stepStates['create-image'].status).toBe('in_progress')
      expect(instance!.stepStates['create-video'].status).toBe('in_progress')
    })

    it('does not advance past group when only one child completes', () => {
      createInstance('task-par1', 'parallel', testDir)
      completeStep('task-par1', 'write-copy', { brief: 'test' }, testDir)
      completeStep('task-par1', 'create-image', { image_path: '/img.png' }, testDir)

      const instance = loadInstance('task-par1', testDir)
      expect(instance!.currentStepId).toBe('create-assets')
      expect(instance!.stepStates['publish'].status).toBe('pending')
    })

    it('advances past group when all children complete', () => {
      createInstance('task-par2', 'parallel', testDir)
      completeStep('task-par2', 'write-copy', { brief: 'test' }, testDir)
      completeStep('task-par2', 'create-image', { image_path: '/img.png' }, testDir)
      completeStep('task-par2', 'create-video', { video_path: '/vid.mp4' }, testDir)

      const instance = loadInstance('task-par2', testDir)
      expect(instance!.currentStepId).toBe('publish')
      expect(instance!.stepStates['publish'].status).toBe('in_progress')
    })

    it('returns correct step for specific agent in parallel group', () => {
      createInstance('task-par3', 'parallel', testDir)
      completeStep('task-par3', 'write-copy', { brief: 'test' }, testDir)

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
      completeStep('task-gate-a', 'write-copy', { text: 'hello' }, testDir)

      const approveResult = approveGate('task-gate-a', 'review-gate', testDir)
      expect(approveResult.success).toBe(true)

      const instance = loadInstance('task-gate-a', testDir)
      expect(instance!.currentStepId).toBe('publish')
      expect(instance!.status).toBe('in_progress')
    })

    it('rejectGate rewinds to target step', () => {
      createInstance('task-gate-r', 'gate', testDir)
      completeStep('task-gate-r', 'write-copy', { text: 'hello' }, testDir)

      const rejectResult = rejectGate('task-gate-r', 'review-gate', 'Not good enough', undefined, testDir)
      expect(rejectResult.success).toBe(true)
      expect(rejectResult.rewoundTo).toBe('write-copy')

      const instance = loadInstance('task-gate-r', testDir)
      expect(instance!.currentStepId).toBe('write-copy')
      expect(instance!.stepStates['write-copy'].status).toBe('in_progress')
    })

    it('rejectGate with note_to_agent includes reason in step context', () => {
      createInstance('task-gate-n', 'gate', testDir)
      completeStep('task-gate-n', 'write-copy', { text: 'hello' }, testDir)

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
      completeStep('task-rew', 'write-copy', { text: 'hello' }, testDir)

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
      completeStep('task-skill-plain', 'write', { caption: 'test' }, testDir)
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
      completeStep('t4', 'step-one', { r: 1 }, testDir)
      completeStep('t4', 'step-two', { r: 2 }, testDir)
      completeStep('t4', 'step-three', { r: 3 }, testDir)

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
      completeStep('task-agents-par', 'write-copy', { brief: 'x' }, testDir)
      const agents = getActiveAgents('task-agents-par', testDir)
      expect(agents.length).toBe(2)
      expect(agents.map(a => a.agent).sort()).toEqual(['pixel', 'rolo'])
    })
  })
})
