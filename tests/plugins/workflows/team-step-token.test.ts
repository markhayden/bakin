/**
 * Workflow-step team targets (#611): the `team:<id>` agent token.
 *
 * - resolveAgent passes an UNRESOLVED token through (dispatch recognizes and
 *   resolves it) and returns the sticky per-step resolution once recorded
 * - getActiveAgents surfaces token steps so dispatch can resolve them
 * - recordStepTeamResolution is first-write-wins (sticky across retries)
 * - getCurrentStep treats the token as the step identity pre-resolution and
 *   the concrete agent post-resolution (lane scoping stays honest)
 * - validateDefinition checks team existence (tiered via knownTeamIds) and
 *   bans hardcoded teams in plugin-shipped workflows
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { taskStoreMock, taskServiceMock, resetRuntimeHarness } from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-team-step-token-${Date.now()}`)

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
mock.module('../../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => testDir,
  getOpenClawPath: (...parts: string[]) => join(testDir, ...parts),
  resetOpenClawHome: mock(),
}))

import { resolveAgent, getActiveAgents, getCurrentStep } from '@bakin/workflows/lib/step-context'
import { recordStepTeamResolution, loadInstance } from '@bakin/workflows/lib/instance-store'
import { createInstance } from '@bakin/workflows/lib/engine'
import { validateDefinition } from '@bakin/workflows/lib/parser'
import { setEventBus } from '@bakin/workflows/lib/notifications'
import type { WorkflowDefinition, WorkflowInstance } from '@bakin/workflows/types'

const TEAM_WORKFLOW = `
name: Team Flow
description: workflow with a team-targeted step
version: 1
steps:
  - id: route-me
    type: agent
    label: Routed step
    agent: "team:builders"
    description: Do the thing
  - id: after
    type: agent
    label: After
    agent: dev
`

function bareInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    instanceId: 'i1',
    workflowId: 'team-flow',
    taskId: 'task-team',
    currentStepId: 'route-me',
    status: 'in_progress',
    stepStates: {},
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('team step token', () => {
  const defsDir = join(testDir, 'workflows', 'definitions')

  beforeEach(() => {
    resetRuntimeHarness()
    setEventBus({ emit: () => {} } as never)
    mkdirSync(defsDir, { recursive: true })
    writeFileSync(join(defsDir, 'team-flow.yaml'), TEAM_WORKFLOW)
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('resolveAgent', () => {
    it('unresolved token passes through', () => {
      expect(resolveAgent('team:builders', bareInstance(), 'route-me')).toBe('team:builders')
    })

    it('without a stepId the token still passes through', () => {
      expect(resolveAgent('team:builders', bareInstance())).toBe('team:builders')
    })

    it('resolved token returns the sticky pick', () => {
      const instance = bareInstance({
        teamResolutions: { 'route-me': { agentId: 'dev', team: 'builders', reason: 'r', at: 'now' } },
      })
      expect(resolveAgent('team:builders', instance, 'route-me')).toBe('dev')
    })

    it('a resolution for a DIFFERENT step does not leak', () => {
      const instance = bareInstance({
        teamResolutions: { other: { agentId: 'dev', team: 'builders', reason: 'r', at: 'now' } },
      })
      expect(resolveAgent('team:builders', instance, 'route-me')).toBe('team:builders')
    })

    it('$assigned behavior unchanged', () => {
      expect(resolveAgent('$assigned', bareInstance({ resolvedAgent: 'chef' }), 'route-me')).toBe('chef')
      expect(resolveAgent('$assigned', bareInstance(), 'route-me')).toBe('$assigned')
    })
  })

  describe('instance lifecycle', () => {
    it('getActiveAgents surfaces the unresolved token; resolution flips it to the member', () => {
      createInstance('task-team', 'team-flow', testDir)

      expect(getActiveAgents('task-team', testDir)).toEqual([
        { agent: 'team:builders', stepId: 'route-me' },
      ])

      const recorded = recordStepTeamResolution('task-team', 'route-me', { agentId: 'dev', team: 'builders', reason: 'best fit' }, testDir)
      expect(recorded?.agentId).toBe('dev')

      expect(getActiveAgents('task-team', testDir)).toEqual([
        { agent: 'dev', stepId: 'route-me' },
      ])
    })

    it('recordStepTeamResolution is first-write-wins (sticky)', () => {
      createInstance('task-team', 'team-flow', testDir)
      const first = recordStepTeamResolution('task-team', 'route-me', { agentId: 'dev', team: 'builders', reason: 'first' }, testDir)
      const second = recordStepTeamResolution('task-team', 'route-me', { agentId: 'reviewer', team: 'builders', reason: 'second' }, testDir)
      expect(first?.agentId).toBe('dev')
      expect(second?.agentId).toBe('dev')
      expect(loadInstance('task-team', testDir)?.teamResolutions?.['route-me']?.reason).toBe('first')
    })

    it('recordStepTeamResolution returns null when the instance is gone', () => {
      expect(recordStepTeamResolution('no-such-task', 's1', { agentId: 'dev', team: 'builders', reason: 'r' }, testDir)).toBeNull()
    })

    it('getCurrentStep honors token identity pre-resolution and the member post-resolution', () => {
      createInstance('task-team', 'team-flow', testDir)

      const stepIdOf = (ctx: ReturnType<typeof getCurrentStep>) =>
        ctx && 'stepId' in ctx ? ctx.stepId : null

      // Pre-resolution: the token IS the step identity; a concrete agent is
      // not the owner yet.
      expect(stepIdOf(getCurrentStep('task-team', 'team:builders', testDir))).toBe('route-me')
      expect(getCurrentStep('task-team', 'dev', testDir)).toBeNull()

      recordStepTeamResolution('task-team', 'route-me', { agentId: 'dev', team: 'builders', reason: 'r' }, testDir)

      // Post-resolution: the member owns the step; the token identity is gone.
      expect(stepIdOf(getCurrentStep('task-team', 'dev', testDir))).toBe('route-me')
      expect(getCurrentStep('task-team', 'team:builders', testDir)).toBeNull()
    })
  })

  describe('validateDefinition — team targets', () => {
    const def = (agent: string, source?: 'user' | 'plugin'): WorkflowDefinition => ({
      name: 'T',
      description: 'd',
      version: 1,
      ...(source ? { source } : {}),
      steps: [{ id: 's1', type: 'agent', label: 'S1', agent }],
    })

    it('known team passes', () => {
      expect(validateDefinition(def('team:builders'), { knownTeamIds: ['builders'] })).toEqual([])
    })

    it('unknown team is rejected when knownTeamIds is provided', () => {
      const errors = validateDefinition(def('team:ghosts'), { knownTeamIds: ['builders'] })
      expect(errors).toEqual([expect.stringContaining('unknown team "ghosts"')])
    })

    it('absent knownTeamIds skips existence checks (tiered)', () => {
      expect(validateDefinition(def('team:ghosts'))).toEqual([])
    })

    it('empty team id is rejected', () => {
      const errors = validateDefinition(def('team:'))
      expect(errors).toEqual([expect.stringContaining('no team id')])
    })

    it('plugin-shipped workflows may not hardcode teams', () => {
      const errors = validateDefinition(def('team:builders', 'plugin'), { source: 'plugin', knownTeamIds: ['builders'] })
      expect(errors).toEqual([expect.stringContaining('plugin-shipped')])
    })

    it('team tokens inside parallel children are validated', () => {
      const parallel: WorkflowDefinition = {
        name: 'P',
        description: 'd',
        version: 1,
        steps: [{
          id: 'par',
          type: 'parallel',
          label: 'Par',
          steps: [{ id: 'c1', type: 'agent', label: 'C1', agent: 'team:ghosts' }],
        } as never],
      }
      const errors = validateDefinition(parallel, { knownTeamIds: ['builders'] })
      expect(errors).toEqual([expect.stringContaining('unknown team "ghosts"')])
    })
  })
})
