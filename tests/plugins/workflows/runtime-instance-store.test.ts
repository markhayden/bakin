/**
 * Workflow runtime tests for the instance-store seam (lib/instance-store.ts):
 * instance persistence on disk and listInstances filtering.
 * Split from runtime.test.ts (FW7); shared scaffold in helpers/runtime-harness.ts.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  taskStoreMock,
  taskServiceMock,
  resetRuntimeHarness,
  seedWorkflowFixtures,
} from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-runtime-instance-store-${Date.now()}`)

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
  completeStep,
  listInstances,
} from '@bakin/workflows/lib/runtime'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import { setEventBus } from '@bakin/workflows/lib/notifications'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'

describe('runtime — instance-store', () => {
  const instancesDir = join(testDir, 'workflows', 'instances')

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
})
