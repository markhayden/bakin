/**
 * Regenerates the dispatch-prompt byte fixtures from the CURRENT builders.
 *
 *   bun tests/fixtures/dispatch-prompts/generate.ts
 *
 * Run ONLY when a prompt change is intentional — the resulting fixture diff
 * is the reviewable record of exactly what changed in every dispatch prompt
 * (issue #357 guardrail). Tests in tests/core/dispatch-prompts.test.ts fail
 * until fixtures match the builders again.
 */
import { writeFileSync } from 'fs'
import { join } from 'path'
import { buildDispatchMessage } from '../../../src/core/dispatch-prompts'
import { buildWorkflowDispatchMessage } from '../../../src/core/dispatch-workflow'
import {
  FIXTURE_CONTENT_DIR,
  MAIN_AGENT,
  SPECIALIST_FULL,
  SPECIALIST_PLAIN,
  TRIAGE,
  WORKFLOW_FULL,
  WORKFLOW_PRIOR_ONLY,
} from './inputs'

const out = (name: string, content: string) => {
  writeFileSync(join(import.meta.dir, `${name}.txt`), content, 'utf-8')
  console.log(`${name}.txt ${content.length} bytes`)
}

out('specialist-plain', buildDispatchMessage(SPECIALIST_PLAIN.task, SPECIALIST_PLAIN.agentName, FIXTURE_CONTENT_DIR, 'main'))
out(
  'specialist-full',
  buildDispatchMessage(
    SPECIALIST_FULL.task,
    SPECIALIST_FULL.agentName,
    FIXTURE_CONTENT_DIR,
    SPECIALIST_FULL.mainAgentId,
    SPECIALIST_FULL.lessonBlock,
    SPECIALIST_FULL.continuation,
    SPECIALIST_FULL.recovery,
    [...SPECIALIST_FULL.roster],
    SPECIALIST_FULL.assetsBlock,
  ),
)
out(
  'triage',
  buildDispatchMessage(TRIAGE.task, TRIAGE.agentName, FIXTURE_CONTENT_DIR, 'main', '', {}, undefined, [...TRIAGE.roster]),
)
out('main-agent', buildDispatchMessage(MAIN_AGENT.task, MAIN_AGENT.agentName, FIXTURE_CONTENT_DIR, 'main'))
out(
  'workflow-full',
  buildWorkflowDispatchMessage(
    WORKFLOW_FULL.task,
    WORKFLOW_FULL.stepContext,
    WORKFLOW_FULL.agentName,
    WORKFLOW_FULL.lessonBlock,
    undefined,
    WORKFLOW_FULL.assetsBlock,
  ),
)
out(
  'workflow-prior-only',
  buildWorkflowDispatchMessage(WORKFLOW_PRIOR_ONLY.task, WORKFLOW_PRIOR_ONLY.stepContext, WORKFLOW_PRIOR_ONLY.agentName),
)
