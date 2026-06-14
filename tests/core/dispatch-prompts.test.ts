/**
 * Prompt-content tests for the dispatch message builders (P14 prevention).
 * Asserts the OUTPUT DISCIPLINE rules ship in every dispatch, the roster is
 * runtime-derived (never hardcoded), and the recovery variants render.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-dispatch-prompts-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock().mockReturnValue({
    dispatch: {
      intervalMs: 1000, maxRetries: 3, failureCooldownMs: 1000, transientCooldownMs: 500,
      maxDispatched: 500, oversizedOutputBytes: 128 * 1024, maxConcurrentTurns: 3, maxTurnsPerAgent: 1,
    },
  }),
}))
mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../src/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: {} })),
  addTaskLog: mock(async () => undefined),
  updateTask: mock(async () => undefined),
  moveTask: mock(async () => undefined),
  blockTask: mock(async () => undefined),
}))
mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock().mockResolvedValue(undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))

import { buildDispatchMessage } from '../../src/core/dispatch'
import { readFileSync } from 'fs'

const specialistTask = { id: 't-1', title: 'Research report', agent: 'jessica', description: 'Six deliverables' }

describe('OUTPUT DISCIPLINE in dispatch prompts', () => {
  it('every specialist dispatch carries the short discipline reminder with the templated save command', () => {
    const msg = buildDispatchMessage(specialistTask, 'jessica', testDir)
    expect(msg).toContain('## OUTPUT DISCIPLINE — MANDATORY')
    expect(msg).toContain('KILLS your runtime session')
    expect(msg).toContain('ONE AT A TIME')
    // The taskId-templated invocation must stay per-dispatch.
    expect(msg).toContain(`bakin_exec_assets_save taskId=${specialistTask.id}`)
    // The full rule prose lives in the AGENTS.md managed block now.
    expect(msg).toContain('Bakin Execution Tools')
  })

  it('static catalog prose has moved to the managed block — not shipped per dispatch', () => {
    const msg = buildDispatchMessage(specialistTask, 'jessica', testDir)
    // Sentinels of the moved static prose:
    expect(msg).not.toContain('NEVER draft several deliverables in a single response')
    expect(msg).not.toContain('Required log points')
    expect(msg).not.toContain('## DEPENDENCY PATTERN')
    expect(msg).not.toContain('These tools help you accomplish the work')
    // Templated invocations all survive.
    expect(msg).toContain(`bakin_exec_tasks_log_progress taskId=${specialistTask.id}`)
    expect(msg).toContain(`bakin_exec_tasks_complete taskId=${specialistTask.id}`)
    expect(msg).toContain(`bakin_exec_tasks_block taskId=${specialistTask.id}`)
    expect(msg).toContain(`bakin_exec_check_gates taskId=${specialistTask.id}`)
  })

  it('workflow step prompts carry the discipline with the step-output variant (no subtasks)', () => {
    // buildWorkflowDispatchMessage is module-private; assert via source that
    // it consumes the same shared section with subtasksAllowed: false.
    const source = readFileSync(join(import.meta.dir, '../../src/core/dispatch.ts'), 'utf-8')
    const wfBuilder = source.slice(source.indexOf('function buildWorkflowDispatchMessage'))
    expect(wfBuilder).toContain('outputDisciplineSection(agentName, task.id, { subtasksAllowed: false })')
    expect(wfBuilder).toContain('sharedExecutionToolDocs(agentName, task.id,')
  })
})

describe('runtime-derived roster (no hardcoded agents in core)', () => {
  it('triage prompt uses the provided roster with roles', () => {
    const msg = buildDispatchMessage(
      { id: 't-2', title: 'Untriaged' },
      'main',
      testDir,
      'main',
      '',
      {},
      undefined,
      [
        { id: 'main' },
        { id: 'ada', role: 'data analysis' },
        { id: 'bo' },
      ],
    )
    expect(msg).toContain('(ada=data analysis, bo)')
    expect(msg).not.toContain('patch=execution')
  })

  it('triage prompt degrades gracefully with no roster', () => {
    const msg = buildDispatchMessage({ id: 't-3', title: 'Untriaged' }, 'main', testDir)
    expect(msg).toContain('assign it to the right agent via')
    expect(msg).not.toContain('patch=execution')
  })

  it('the dispatch module contains no hardcoded agent roster', () => {
    const source = readFileSync(join(import.meta.dir, '../../src/core/dispatch.ts'), 'utf-8')
    expect(source).not.toContain('patch=execution')
    expect(source).not.toContain('pixel=design')
  })
})

describe('recovery prompt variants', () => {
  const recovery = {
    stage: 'corrective' as const,
    deaths: 1,
    lastDiagnosis: {
      reason: 'session_interrupted',
      sessionStatus: 'interrupted',
      completionBytes: 708567,
      oversizedOutput: true,
      detail: 'OpenClaw session interrupted after oversized model completion (692KB, truncated)',
    },
    salvagedAssetIds: ['asset-a1'],
  }

  it('corrective prompt opens with the failure explanation and salvage pointer', () => {
    const msg = buildDispatchMessage(specialistTask, 'jessica', testDir, 'main', '', {}, recovery)
    expect(msg.startsWith('## PREVIOUS ATTEMPT FAILED — READ FIRST')).toBe(true)
    expect(msg).toContain('~692KB')
    expect(msg).toContain('asset-a1')
    expect(msg).toContain('REUSE it instead of regenerating')
    // The actual task follows the corrective preamble.
    expect(msg).toContain('Work on this task: "Research report"')
  })
})
