import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-test-plugin-node-${Date.now()}`)

// ─── CRITICAL: Mock content-dir (project rule) ─────────────────────────────
vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: vi.fn(),
  initBakinHome: vi.fn(),
  isUsingBakinHome: () => false,
}))

vi.mock('../../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

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

vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => testDir,
  getOpenClawPath: (...parts: string[]) => join(testDir, ...parts),
  resetOpenClawHome: vi.fn(),
}))

// Imports must follow the mocks.
import {
  createInstance,
  getCurrentStep,
  completeStep,
  getActiveAgents,
  loadInstance,
} from '@bakin/workflows/lib/runtime'
import {
  registerPluginNodeType,
  unregisterPluginNodeTypes,
} from '@bakin/workflows/lib/node-type-registry'
import { workflowDefinitionSchema } from '@bakin/workflows/lib/node-type-registry'
import { getHookRegistry } from '../../../src/lib/plugin-registry'

/**
 * End-to-end integration test for plugin-registered workflow node types.
 *
 * Exercises:
 *   1. `registerPluginNodeType` adds the kind to the registry under
 *      `{pluginId}.{kind}` and the top-level `workflowDefinitionSchema`
 *      accepts step bodies of that kind via the passthrough branch.
 *   2. `createInstance` on a workflow whose first step is a plugin kind
 *      fires the `workflows.executeNode.{namespacedKind}` hook with the
 *      step payload — no builtin dispatch path is taken.
 *   3. The plugin's handler calls `completeStep` and the workflow
 *      advances through the next built-in step to completion.
 *   4. `getActiveAgents` returns `[]` while the plugin step is
 *      in_progress — Bakin's agent dispatch loop must not touch
 *      plugin-owned kinds.
 *   5. `unregisterPluginNodeTypes` cleans up so the next run starts
 *      clean (matches hot-reload behavior).
 */

const PLUGIN_ID = 'fx'
const UNPREFIXED_KIND = 'noise-gate'
const NAMESPACED_KIND = `${PLUGIN_ID}.${UNPREFIXED_KIND}`

const noiseGateSchema = z.object({
  id: z.string().min(1),
  type: z.literal(NAMESPACED_KIND),
  label: z.string().min(1),
  threshold_db: z.number(),
  // Plugin steps opt into `dependsOn` if they want it; we include it to
  // match the builtin shape.
  dependsOn: z.union([z.string(), z.array(z.string())]).optional(),
})

describe('plugin node-type integration', () => {
  const defsDir = join(testDir, 'workflows', 'definitions')
  const instancesDir = join(testDir, 'workflows', 'instances')

  beforeEach(() => {
    mkdirSync(defsDir, { recursive: true })
    mkdirSync(instancesDir, { recursive: true })

    // Workflow: [plugin-step → agent-step]
    writeFileSync(
      join(defsDir, 'fx-demo.yaml'),
      `name: FX Demo
description: plugin kind + agent follow-up
version: 1
steps:
  - id: denoise
    type: ${NAMESPACED_KIND}
    label: Denoise audio
    threshold_db: -48
  - id: polish
    type: agent
    label: Polish output
    agent: basil
    description: Final polish
`,
      'utf-8',
    )
  })

  afterEach(() => {
    unregisterPluginNodeTypes(PLUGIN_ID)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('accepts plugin kind through the top-level workflow schema', () => {
    registerPluginNodeType(PLUGIN_ID, {
      kind: UNPREFIXED_KIND,
      zodSchema: noiseGateSchema,
      formFields: [{ name: 'threshold_db', type: 'number', required: true }],
    })

    const result = workflowDefinitionSchema.safeParse({
      name: 'FX Demo',
      description: 'plugin kind + agent follow-up',
      version: 1,
      steps: [
        {
          id: 'denoise',
          type: NAMESPACED_KIND,
          label: 'Denoise audio',
          threshold_db: -48,
        },
        {
          id: 'polish',
          type: 'agent',
          label: 'Polish output',
          agent: 'basil',
          description: 'Final polish',
        },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('surfaces a targeted error when a plugin kind is not registered', () => {
    // Note: no registerPluginNodeType call.
    const result = workflowDefinitionSchema.safeParse({
      name: 'FX Demo',
      description: 'plugin kind + agent follow-up',
      version: 1,
      steps: [
        {
          id: 'denoise',
          type: 'fx.never-registered',
          label: 'Denoise audio',
          threshold_db: -48,
        },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('\n')
      expect(messages).toMatch(/Unknown node type 'fx\.never-registered'/)
    }
  })

  it('dispatches plugin kinds via the executeNode hook; getActiveAgents returns []; handler completion advances workflow', async () => {
    registerPluginNodeType(PLUGIN_ID, {
      kind: UNPREFIXED_KIND,
      zodSchema: noiseGateSchema,
      formFields: [{ name: 'threshold_db', type: 'number', required: true }],
    })

    const hookName = `workflows.executeNode.${NAMESPACED_KIND}`
    const hookCalls: unknown[] = []
    const unsubscribe = getHookRegistry().register(hookName, (payload) => {
      hookCalls.push(payload)
    })

    try {
      // Act: create the instance — this marks the plugin step in_progress
      // AND should fire the hook with the step payload.
      const instance = createInstance('task-1', 'fx-demo', testDir, 'basil')

      // The runtime schedules the hook invocation asynchronously (fire-and-
      // forget via `.catch`). A microtask flush is enough — no real timers.
      await Promise.resolve()
      await Promise.resolve()

      expect(hookCalls).toHaveLength(1)
      const payload = hookCalls[0] as {
        taskId: string
        stepId: string
        step: { type: string; threshold_db: number }
        contentDir: string
      }
      expect(payload.taskId).toBe('task-1')
      expect(payload.stepId).toBe('denoise')
      expect(payload.step.type).toBe(NAMESPACED_KIND)
      expect(payload.step.threshold_db).toBe(-48)
      expect(payload.contentDir).toBe(testDir)

      // Plugin steps don't feed Bakin's agent dispatch loop.
      expect(getActiveAgents('task-1', testDir)).toEqual([])

      // And the current-step API should surface the plugin kind by id
      // (plugins may ignore it, but `getCurrentStep` must not throw on
      // unknown kinds).
      const current = getCurrentStep('task-1', undefined, testDir)
      expect(current).toBeTruthy()
      expect((current as { stepId: string }).stepId).toBe('denoise')

      // Simulate the plugin completing its work.
      const res = completeStep('task-1', 'denoise', { cleaned_audio: 'audio://cleaned' }, undefined, testDir)
      expect(res.success).toBe(true)

      // Workflow should have advanced to the next (agent) step.
      const after = loadInstance('task-1', testDir)!
      expect(after.currentStepId).toBe('polish')
      expect(after.stepStates['denoise'].status).toBe('complete')
      expect(after.stepStates['polish'].status).toBe('in_progress')
      expect(after.stepStates['denoise'].output).toEqual({ cleaned_audio: 'audio://cleaned' })
    } finally {
      unsubscribe()
    }
  })

  it('stalls with a warning when the plugin hook has no handler (plugin inactive)', async () => {
    // Register the node type but do NOT register a hook handler — simulates
    // a plugin that declared its kinds but crashed or never activated its
    // runtime surface.
    registerPluginNodeType(PLUGIN_ID, {
      kind: UNPREFIXED_KIND,
      zodSchema: noiseGateSchema,
      formFields: [{ name: 'threshold_db', type: 'number', required: true }],
    })

    // No throw — dispatchPluginNode logs and returns.
    const instance = createInstance('task-2', 'fx-demo', testDir, 'basil')
    await Promise.resolve()

    // Step is still in_progress (nothing advanced it).
    const loaded = loadInstance('task-2', testDir)!
    expect(loaded.currentStepId).toBe('denoise')
    expect(loaded.stepStates['denoise'].status).toBe('in_progress')
    expect(loaded.stepStates['polish'].status).toBe('pending')
  })
})
