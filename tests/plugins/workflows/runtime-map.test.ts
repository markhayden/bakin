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
} from '@bakin/workflows/lib/runtime'
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
        // item under item_key, plus map coordinates, plus the source output
        expect(child.parentContext).toMatchObject({
          brief: items[i],
          mapIndex: i,
          mapTotal: 3,
          items,
        })
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
})
