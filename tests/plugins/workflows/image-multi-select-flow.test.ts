/**
 * image-multi-select end-to-end engine flow (#203 PR4): drives the REAL
 * shipped YAMLs (plugins/images/defaults/workflows/) through the workflow
 * engine with scripted step outputs — prompt → gate → 3-child map fan-out →
 * ordered join → select-best → gate → deliver. No live runtime, no billing.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { copyFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { taskStoreMock, taskServiceMock, resetRuntimeHarness } from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-mis-flow-${Date.now()}`)

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

import {
  createInstance,
  loadInstance,
  completeStep,
  approveGate,
  rejectGate,
} from '@bakin/workflows/lib/runtime'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import { setEventBus } from '@bakin/workflows/lib/notifications'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'

const defsDir = join(testDir, 'workflows', 'definitions')
const REAL_DEFAULTS = join(process.cwd(), 'plugins', 'images', 'defaults', 'workflows')

const promptOutput = {
  prompt: 'A serene fox in morning light',
  promptPacket: { subject: 'fox', surface: 'instagram-feed-portrait' },
  route: { provider: 'openai', model: 'gpt-image-1-mini', surface: 'instagram-feed-portrait', quality: 'draft' },
  variants: [
    'Close-up portrait, shallow depth of field',
    'Wide environmental shot, golden hour backlight',
    'Stylized flat illustration, bold shapes',
  ],
}

const approver = { id: 'mark', source: 'web' as const }

describe('image-multi-select — engine flow over the shipped YAMLs', () => {
  beforeEach(() => {
    invalidateSkillCache()
    resetRuntimeHarness()
    mkdirSync(defsDir, { recursive: true })
    mkdirSync(join(testDir, 'workflows', 'instances'), { recursive: true })
    mkdirSync(join(testDir, 'workflows', 'skills'), { recursive: true })
    copyFileSync(join(REAL_DEFAULTS, 'image-multi-select.yaml'), join(defsDir, 'image-multi-select.yaml'))
    copyFileSync(join(REAL_DEFAULTS, 'image-variant.yaml'), join(defsDir, 'image-variant.yaml'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    getHookRegistry().clearAll()
    setEventBus({ emit: () => {} } as never)
  })

  it('runs prompt → gate → 3-child fan-out → ordered join → select → gate → deliver', () => {
    createInstance('task-mis', 'image-multi-select', testDir, 'pixel')

    // 1. develop-prompt completes with the packet + 3 variant directives.
    expect(completeStep('task-mis', 'develop-prompt', promptOutput, undefined, testDir).success).toBe(true)
    let inst = loadInstance('task-mis', testDir)!
    expect(inst.status).toBe('pending_approval')
    expect(inst.currentStepId).toBe('prompt-gate')

    // 2. Prompt gate approval fans out — ZERO children existed before.
    expect(loadInstance('task-mis--generate-variants--0', testDir)).toBeNull()
    expect(approveGate('task-mis', 'prompt-gate', { contentDir: testDir, approver }).success).toBe(true)
    inst = loadInstance('task-mis', testDir)!
    expect(inst.currentStepId).toBe('generate-variants')
    const entries = inst.stepStates['generate-variants'].children!
    expect(entries).toHaveLength(3)

    // Children carry the packet + their directive under item_key "variant".
    for (let i = 0; i < 3; i++) {
      const child = loadInstance(`task-mis--generate-variants--${i}`, testDir)!
      expect(child.workflowId).toBe('image-variant')
      expect(child.parentContext).toMatchObject({
        variant: promptOutput.variants[i],
        mapIndex: i,
        mapTotal: 3,
        prompt: promptOutput.prompt,
      })
    }

    // 3. Children complete OUT OF ORDER; the join aggregates in source order.
    for (const i of [1, 2, 0]) {
      const r = completeStep(`task-mis--generate-variants--${i}`, 'generate-variant', {
        assetId: `asset-v${i}`, version: 1, provider: 'openai', model: 'gpt-image-1-mini', promptHash: `sha-${i}`,
      }, undefined, testDir)
      expect(r.success).toBe(true)
    }
    inst = loadInstance('task-mis', testDir)!
    expect(inst.currentStepId).toBe('select-best')
    const aggregate = inst.stepStates['generate-variants'].output as { outputs: Array<{ assetId: string }> }
    expect(aggregate.outputs.map((o) => o.assetId)).toEqual(['asset-v0', 'asset-v1', 'asset-v2'])

    // 4. select-best consolidates and submits the winner.
    expect(completeStep('task-mis', 'select-best', {
      assetId: 'asset-v1', selectedVersion: 1, rationale: 'Best light and composition',
    }, undefined, testDir).success).toBe(true)
    inst = loadInstance('task-mis', testDir)!
    expect(inst.currentStepId).toBe('selection-gate')

    // 5. Selection gate approval → deliver → complete.
    expect(approveGate('task-mis', 'selection-gate', { contentDir: testDir, approver }).success).toBe(true)
    const done = completeStep('task-mis', 'deliver', {
      assetId: 'asset-v1', selectedVersion: 1, summary: 'Delivered the winning variant',
    }, undefined, testDir)
    expect(done.success).toBe(true)
    expect(done.workflowComplete).toBe(true)
    expect(loadInstance('task-mis', testDir)!.status).toBe('complete')
  })

  it('prompt-gate rejection rewinds without spawning any children (spend guard)', () => {
    createInstance('task-mis-reject', 'image-multi-select', testDir, 'pixel')
    completeStep('task-mis-reject', 'develop-prompt', promptOutput, undefined, testDir)

    const rejected = rejectGate('task-mis-reject', 'prompt-gate', 'Directives too similar', { contentDir: testDir, approver })
    expect(rejected.success).toBe(true)

    const inst = loadInstance('task-mis-reject', testDir)!
    expect(inst.currentStepId).toBe('develop-prompt')
    expect(inst.stepStates['develop-prompt'].rejectionReason).toBe('Directives too similar')
    expect(loadInstance('task-mis-reject--generate-variants--0', testDir)).toBeNull()
  })

  it('selection-gate rejection reopens select-best with the previous pick as context', () => {
    createInstance('task-mis-reselect', 'image-multi-select', testDir, 'pixel')
    completeStep('task-mis-reselect', 'develop-prompt', promptOutput, undefined, testDir)
    approveGate('task-mis-reselect', 'prompt-gate', { contentDir: testDir, approver })
    for (const i of [0, 1, 2]) {
      completeStep(`task-mis-reselect--generate-variants--${i}`, 'generate-variant', {
        assetId: `asset-r${i}`, version: 1, provider: 'openai', model: 'gpt-image-1-mini', promptHash: `sha-${i}`,
      }, undefined, testDir)
    }
    completeStep('task-mis-reselect', 'select-best', {
      assetId: 'asset-r0', selectedVersion: 1, rationale: 'first pick',
    }, undefined, testDir)

    const rejected = rejectGate('task-mis-reselect', 'selection-gate', 'Prefer the wide shot', { contentDir: testDir, approver })
    expect(rejected.success).toBe(true)

    const inst = loadInstance('task-mis-reselect', testDir)!
    expect(inst.currentStepId).toBe('select-best')
    expect(inst.stepStates['select-best'].previousOutput).toMatchObject({ assetId: 'asset-r0' })
    // The map join result is untouched — no regeneration on re-select.
    expect(inst.stepStates['generate-variants'].status).toBe('complete')
  })
})
