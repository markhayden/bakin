/**
 * Deterministic inputs shared by the fixture generator and the byte-identity
 * tests in tests/core/dispatch-prompts.test.ts. Fixtures pin the EXACT prompt
 * bytes — regenerate deliberately with:
 *
 *   bun tests/fixtures/dispatch-prompts/generate.ts
 *
 * so any prompt change shows up as a reviewable fixture diff in the same
 * commit (guardrail for issue #357: no silent context growth).
 */
import type { SessionDeathState } from '../../../src/core/dispatch-types'

export const FIXTURE_CONTENT_DIR = '/fixture/bakin-home'

export const CORRECTIVE_RECOVERY: SessionDeathState = {
  stage: 'corrective',
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

export const ASSETS_BLOCK =
  '\n\n## Attached Assets\nThis task has 1 linked asset(s). Review them for context before starting:\n- asset-b2 — reference brief\nOpen with bakin_exec_assets_open using the assetId to read the current content + metadata. AssetIds are stable identity — do not store raw disk paths.'

export const LESSON_BLOCK = '## Lessons From Past Work\n- Keep image prompts under 60 words.'

export const SPECIALIST_PLAIN = {
  task: { id: 't-fix-1', title: 'Research report', agent: 'jessica', description: 'Six deliverables\nacross two sections' },
  agentName: 'jessica',
} as const

export const SPECIALIST_FULL = {
  task: {
    id: 't-fix-2',
    title: 'Research report',
    agent: 'jessica',
    description: 'Six deliverables\nacross two sections',
    projectId: 'proj-9',
  },
  agentName: 'jessica',
  mainAgentId: 'main',
  lessonBlock: LESSON_BLOCK,
  continuation: { completedDependency: { id: 't-dep', title: 'Gather sources' } },
  recovery: CORRECTIVE_RECOVERY,
  roster: [],
  assetsBlock: ASSETS_BLOCK,
} as const

export const TRIAGE = {
  task: { id: 't-fix-3', title: 'Untriaged thing', description: 'Needs an owner' },
  agentName: 'main',
  roster: [{ id: 'main' }, { id: 'ada', role: 'data analysis' }, { id: 'bo' }],
} as const

export const MAIN_AGENT = {
  task: { id: 't-fix-4', title: 'Main task', agent: 'main', description: 'Do the thing' },
  agentName: 'main',
} as const

// Branded dispatch (#419): the brand card is pre-resolved by the dispatch
// layer and passed into the pure builders — the fixture carries a synthetic
// card, no brand store on disk.
export const BRAND_CARD_BLOCK = [
  '## Brand: Acme (acme)',
  '',
  "All output for this task MUST follow this brand. Use ONLY this brand's materials — disregard knowledge of any other brand.",
  '',
  '### Rules (absolute)',
  '- Never use emojis',
  '',
  '### Palette',
  '- ink: #1A1A2E (primary text)',
].join('\n')

export const SPECIALIST_BRANDED = {
  task: {
    id: 't-fix-5',
    title: 'Write launch tweet',
    agent: 'jessica',
    description: 'Announce the launch',
    projectId: 'proj-9',
    brandId: 'acme',
  },
  agentName: 'jessica',
  brand: { brandId: 'acme', block: BRAND_CARD_BLOCK },
} as const

export const TRIAGE_BRANDED = {
  task: { id: 't-fix-6', title: 'Untriaged branded thing', description: 'Needs an owner', brandId: 'acme' },
  agentName: 'main',
  roster: [{ id: 'main' }, { id: 'ada', role: 'data analysis' }],
  brand: { brandId: 'acme', block: BRAND_CARD_BLOCK },
} as const

export const WORKFLOW_BRANDED = {
  task: { id: 't-wf-3', title: 'Pipeline task', description: 'Campaign context' },
  stepContext: {
    stepId: 'write-copy',
    label: 'Write Copy',
    instructions: 'Write the campaign copy.',
  },
  agentName: 'jessica',
  brand: { brandId: 'acme', block: BRAND_CARD_BLOCK },
} as const

// stepOutputs insertion order mirrors step-context.ts: prior steps in
// definition order, __parentContext appended LAST.
export const WORKFLOW_FULL = {
  task: { id: 't-wf-1', title: 'Pipeline task', description: 'Campaign context' },
  stepContext: {
    stepId: 'write-copy',
    label: 'Write Copy',
    type: 'output',
    instructions: 'Write the campaign copy.',
    output_schema: {
      type: 'object',
      properties: { copy: { type: 'string' } },
      required: ['copy'],
    } as Record<string, unknown>,
    rejectionReason: 'Copy exceeded the length budget',
    previousOutput: { copy: 'previous rejected draft' } as Record<string, unknown>,
    stepOutputs: {
      research: { findings: 'Audience prefers short copy' },
      outline: { sections: ['hook', 'body'] },
      __parentContext: {
        _parentTaskTitle: 'Parent campaign',
        _parentTaskDescription: 'Quarterly launch',
        upstream: 'handoff-data',
      },
    } as Record<string, Record<string, unknown>>,
    deny_tools: ['browser'] as string[],
  },
  agentName: 'jessica',
  lessonBlock: LESSON_BLOCK,
  assetsBlock: ASSETS_BLOCK,
}

export const WORKFLOW_PRIOR_ONLY = {
  task: { id: 't-wf-2', title: 'Pipeline task', description: 'Campaign context' },
  stepContext: {
    stepId: 'review',
    label: 'Review',
    instructions: 'Review the draft.',
    priorStepOutput: { copy: 'draft to review' } as Record<string, unknown>,
  },
  agentName: 'main',
}
