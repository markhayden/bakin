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
mock.module('../../src/core/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock().mockResolvedValue(undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock().mockResolvedValue(undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))

import { buildDispatchMessage } from '../../src/core/dispatch'
import { buildDispatchSections } from '../../src/core/dispatch-prompts'
import { buildWorkflowDispatchMessage, buildWorkflowDispatchSections } from '../../src/core/dispatch-workflow'
import {
  FIXTURE_CONTENT_DIR,
  MAIN_AGENT,
  SPECIALIST_FULL,
  SPECIALIST_PLAIN,
  TRIAGE,
  WORKFLOW_FULL,
  WORKFLOW_PRIOR_ONLY,
} from '../fixtures/dispatch-prompts/inputs'
import { readFileSync } from 'fs'

const specialistTask = { id: 't-1', title: 'Research report', agent: 'jessica', description: 'Six deliverables' }
const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, `../fixtures/dispatch-prompts/${name}.txt`), 'utf-8')

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
    const msg = buildWorkflowDispatchMessage(
      WORKFLOW_FULL.task,
      WORKFLOW_FULL.stepContext,
      WORKFLOW_FULL.agentName,
    )
    expect(msg).toContain('## OUTPUT DISCIPLINE — MANDATORY')
    // Step variant: save-as-asset guidance, never subtask splitting.
    expect(msg).toContain('reference the asset id in your submitted output')
    expect(msg).not.toContain('split into subtasks')
    expect(msg).toContain(`bakin_exec_check_gates taskId=${WORKFLOW_FULL.task.id}`)
  })
})

describe('prompt byte fixtures + labeled sections', () => {
  const cases: Array<{ name: string; build: () => string; sections: () => Array<{ source: string; text: string }>; joiner: string }> = [
    {
      name: 'specialist-plain',
      build: () => buildDispatchMessage(SPECIALIST_PLAIN.task, SPECIALIST_PLAIN.agentName, FIXTURE_CONTENT_DIR),
      sections: () => buildDispatchSections(SPECIALIST_PLAIN.task, SPECIALIST_PLAIN.agentName, FIXTURE_CONTENT_DIR),
      joiner: '',
    },
    {
      name: 'specialist-full',
      build: () =>
        buildDispatchMessage(
          SPECIALIST_FULL.task, SPECIALIST_FULL.agentName, FIXTURE_CONTENT_DIR, SPECIALIST_FULL.mainAgentId,
          SPECIALIST_FULL.lessonBlock, SPECIALIST_FULL.continuation, SPECIALIST_FULL.recovery,
          [...SPECIALIST_FULL.roster], SPECIALIST_FULL.assetsBlock,
        ),
      sections: () =>
        buildDispatchSections(
          SPECIALIST_FULL.task, SPECIALIST_FULL.agentName, FIXTURE_CONTENT_DIR, SPECIALIST_FULL.mainAgentId,
          SPECIALIST_FULL.lessonBlock, SPECIALIST_FULL.continuation, SPECIALIST_FULL.recovery,
          [...SPECIALIST_FULL.roster], SPECIALIST_FULL.assetsBlock,
        ),
      joiner: '',
    },
    {
      name: 'triage',
      build: () => buildDispatchMessage(TRIAGE.task, TRIAGE.agentName, FIXTURE_CONTENT_DIR, 'main', '', {}, undefined, [...TRIAGE.roster]),
      sections: () => buildDispatchSections(TRIAGE.task, TRIAGE.agentName, FIXTURE_CONTENT_DIR, 'main', '', {}, undefined, [...TRIAGE.roster]),
      joiner: '',
    },
    {
      name: 'main-agent',
      build: () => buildDispatchMessage(MAIN_AGENT.task, MAIN_AGENT.agentName, FIXTURE_CONTENT_DIR),
      sections: () => buildDispatchSections(MAIN_AGENT.task, MAIN_AGENT.agentName, FIXTURE_CONTENT_DIR),
      joiner: '',
    },
    {
      name: 'workflow-full',
      build: () =>
        buildWorkflowDispatchMessage(
          WORKFLOW_FULL.task, WORKFLOW_FULL.stepContext, WORKFLOW_FULL.agentName,
          WORKFLOW_FULL.lessonBlock, undefined, WORKFLOW_FULL.assetsBlock,
        ),
      sections: () =>
        buildWorkflowDispatchSections(
          WORKFLOW_FULL.task, WORKFLOW_FULL.stepContext, WORKFLOW_FULL.agentName,
          WORKFLOW_FULL.lessonBlock, undefined, WORKFLOW_FULL.assetsBlock,
        ),
      joiner: '\n',
    },
    {
      name: 'workflow-prior-only',
      build: () => buildWorkflowDispatchMessage(WORKFLOW_PRIOR_ONLY.task, WORKFLOW_PRIOR_ONLY.stepContext, WORKFLOW_PRIOR_ONLY.agentName),
      sections: () => buildWorkflowDispatchSections(WORKFLOW_PRIOR_ONLY.task, WORKFLOW_PRIOR_ONLY.stepContext, WORKFLOW_PRIOR_ONLY.agentName),
      joiner: '\n',
    },
  ]

  for (const c of cases) {
    it(`${c.name}: builder output matches the committed byte fixture`, () => {
      // Regenerate deliberately: bun tests/fixtures/dispatch-prompts/generate.ts
      expect(c.build()).toBe(fixture(c.name))
    })

    it(`${c.name}: labeled sections join byte-identically to the message`, () => {
      const sections = c.sections()
      expect(sections.map((s) => s.text).join(c.joiner)).toBe(c.build())
      expect(sections.every((s) => s.source.length > 0 && s.text.length > 0)).toBe(true)
    })
  }

  it('specialist sections carry stable source labels for the context report', () => {
    const sources = cases[1].sections().map((s) => s.source)
    for (const expected of [
      'corrective', 'task-header', 'description', 'continuation', 'assets', 'project', 'lessons',
      'progress-logging', 'output-discipline', 'task-commands', 'shared-tool-docs', 'project-tools',
      'task-commands-close',
    ]) {
      expect(sources).toContain(expected)
    }
  })

  it('static boilerplate stays inside its byte budget (#357 creep guard)', () => {
    // Post-trim baselines (2026-07): task 2275 B, workflow 3292 B. The
    // ceilings leave ~10% headroom for legitimate wording tweaks; growth past
    // them means per-dispatch boilerplate is creeping back — move static
    // prose to the role-layer catalog (team-context-defaults.ts) instead, or
    // consciously raise the budget in the same commit that explains why.
    const staticBytes = (sections: Array<{ text: string }>) =>
      sections.reduce((n, s) => n + Buffer.byteLength(s.text, 'utf-8'), 0)
    const task = buildDispatchSections({ id: '00000000', title: '', agent: 'jessica' }, 'jessica', testDir)
    const workflow = buildWorkflowDispatchSections({ id: '00000000', title: '' }, { stepId: 'step', label: '' }, 'jessica')
    expect(staticBytes(task)).toBeLessThanOrEqual(2560)
    expect(staticBytes(workflow)).toBeLessThanOrEqual(3584)
  })

  it('workflow sections label the prior-step dump for the context report', () => {
    const sources = cases[4].sections().map((s) => s.source)
    for (const expected of [
      'identity', 'hard-constraints', 'output-discipline', 'revision', 'workflow-context',
      'lessons', 'assets', 'task-instructions', 'output-schema', 'progress-logging', 'commands', 'stop',
    ]) {
      expect(sources).toContain(expected)
    }
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

  it('the dispatch prompt builders contain no hardcoded agent roster', () => {
    // The prompt assembly lives in dispatch-prompts.ts + dispatch-workflow.ts now;
    // scan both so the check still covers where a hardcoded roster could appear.
    const source =
      readFileSync(join(import.meta.dir, '../../src/core/dispatch-prompts.ts'), 'utf-8') +
      readFileSync(join(import.meta.dir, '../../src/core/dispatch-workflow.ts'), 'utf-8')
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
