/**
 * Workflow prior-step context cap (#357, spec D3).
 *
 * The WORKFLOW CONTEXT block was the largest uncapped dispatch-prompt
 * contributor (unbounded JSON dump of ALL prior step outputs). Retention
 * rules: newest step outputs first, whole outputs only (no mid-JSON
 * truncation), the most recent output is always kept, __parentContext
 * title/description lines are always kept (its JSON body is budgeted
 * lowest-priority), and every omission is a visible marker pointing at
 * bakin_exec_workflows_get_instance — never silent.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-wf-context-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: () => ({ dispatch: {} }),
}))
mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock().mockReturnValue({ invoke: mock().mockResolvedValue(undefined), has: () => false, register: mock() }),
}))

import {
  buildWorkflowDispatchMessage,
  resolveWorkflowContextBudget,
} from '../../src/core/dispatch-workflow'

const task = { id: 't-cap-1', title: 'Pipeline task' }
const step = { stepId: 'assemble', label: 'Assemble' }

function bigOutput(marker: string, bytes: number): Record<string, unknown> {
  return { marker, payload: 'x'.repeat(bytes) }
}

describe('resolveWorkflowContextBudget', () => {
  it('defaults when unset/zero/invalid and clamps to the minimum', () => {
    expect(resolveWorkflowContextBudget(undefined)).toBe(16384)
    expect(resolveWorkflowContextBudget(0)).toBe(16384)
    expect(resolveWorkflowContextBudget(-5)).toBe(16384)
    expect(resolveWorkflowContextBudget(Number.NaN)).toBe(16384)
    expect(resolveWorkflowContextBudget(10)).toBe(1024)
    expect(resolveWorkflowContextBudget(20000)).toBe(20000)
  })
})

describe('workflow context cap', () => {
  it('keeps everything (byte-identical path) when under the budget', () => {
    const stepOutputs = { research: bigOutput('research', 100), outline: bigOutput('outline', 100) }
    const capped = buildWorkflowDispatchMessage(task, { ...step, stepOutputs }, 'jessica')
    expect(capped).toContain('"marker": "research"')
    expect(capped).toContain('"marker": "outline"')
    expect(capped).not.toContain('omitted')
  })

  it('drops OLDEST outputs first with a visible marker naming the count and the recovery tool', () => {
    const stepOutputs = {
      'step-a': bigOutput('oldest', 1200),
      'step-b': bigOutput('middle', 1200),
      'step-c': bigOutput('newest', 1200),
    }
    const msg = buildWorkflowDispatchMessage(
      task, { ...step, stepOutputs }, 'jessica', '', undefined, '',
      { maxWorkflowContextBytes: 2048 },
    )
    expect(msg).toContain('"marker": "newest"')
    expect(msg).not.toContain('"marker": "oldest"')
    expect(msg).not.toContain('### Step: step-a')
    expect(msg).toContain('step outputs omitted')
    expect(msg).toContain('bakin_exec_workflows_get_instance')
    // Kept outputs are whole — never mid-JSON truncated.
    expect(msg).toContain(JSON.stringify(stepOutputs['step-c'], null, 2))
  })

  it('always keeps the most recent output even when it alone exceeds the budget', () => {
    const stepOutputs = {
      'step-a': bigOutput('oldest', 500),
      'step-b': bigOutput('newest', 5000),
    }
    const msg = buildWorkflowDispatchMessage(
      task, { ...step, stepOutputs }, 'jessica', '', undefined, '',
      { maxWorkflowContextBytes: 1024 },
    )
    expect(msg).toContain('"marker": "newest"')
    expect(msg).not.toContain('"marker": "oldest"')
    expect(msg).toContain('1 earlier step output omitted')
  })

  it('always keeps parent title/description lines; the parent JSON body is budgeted lowest-priority', () => {
    const stepOutputs = {
      'step-a': bigOutput('newest', 1500),
      __parentContext: {
        _parentTaskTitle: 'Parent campaign',
        _parentTaskDescription: 'Quarterly launch',
        upstream: 'y'.repeat(1500),
      },
    }
    const msg = buildWorkflowDispatchMessage(
      task, { ...step, stepOutputs }, 'jessica', '', undefined, '',
      { maxWorkflowContextBytes: 2048 },
    )
    expect(msg).toContain('**Parent Task:** Parent campaign')
    expect(msg).toContain('**Description:** Quarterly launch')
    expect(msg).not.toContain('y'.repeat(100))
    expect(msg).toContain('upstream handoff data omitted')
    expect(msg).toContain('"marker": "newest"')
  })

  it('keeps the parent JSON body when the budget allows it', () => {
    const stepOutputs = {
      'step-a': bigOutput('newest', 200),
      __parentContext: { _parentTaskTitle: 'Parent', upstream: 'handoff' },
    }
    const msg = buildWorkflowDispatchMessage(
      task, { ...step, stepOutputs }, 'jessica', '', undefined, '',
      { maxWorkflowContextBytes: 8192 },
    )
    expect(msg).toContain('"upstream": "handoff"')
    expect(msg).not.toContain('omitted')
  })
})
