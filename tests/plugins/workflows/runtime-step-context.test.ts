/**
 * Workflow runtime tests for the step-context seam (lib/step-context.ts):
 * getCurrentStep context assembly, skill resolution, deny_tools,
 * getActiveAgents, and agent-scoping/authorizeWorkflowToolUse.
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
} from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-runtime-step-context-${Date.now()}`)

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
  getCurrentStep,
  completeStep,
  cancelInstance,
  getActiveAgents,
  authorizeWorkflowToolUse,
} from '@bakin/workflows/lib/runtime'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import { setEventBus } from '@bakin/workflows/lib/notifications'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'

describe('runtime — step-context', () => {
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

  // ─── getCurrentStep ───────────────────────────────────────────────

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

    it('returns status cancelled for a cancelled instance — honest terminal, never a false "complete" (#604 T6)', () => {
      createInstance('task-cancelled', 'linear', testDir)
      completeStep('task-cancelled', 'step-one', { result: 'a' }, undefined, testDir)
      cancelInstance('task-cancelled', testDir)
      expect(getCurrentStep('task-cancelled', undefined, testDir)).toEqual({ status: 'cancelled' })
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
})
