import '@makinbakin/sdk/styles.css'

import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { WorkflowsPage } from '../components/workflows-page'
import { WorkflowRecoverView } from '../components/workflow-recover-banner'
import type { WorkflowTemplate } from '../types'

// Exercise the real list page without loading unrelated canvas/approval slots.
const templates: WorkflowTemplate[] = [
  {
    filename: 'editorial-launch',
    name: 'Seasonal editorial launch with cross-team review and publication approval',
    description: 'Coordinate copy, photography, and channel-specific production, then pause for owner review before publishing the launch package.',
    source: 'user', stepCount: 3,
    definition: {
      name: 'Editorial launch', description: 'Coordinate a seasonal campaign.', version: 1,
      steps: [
        { id: 'draft', type: 'agent', label: 'Draft the campaign', agent: '$assigned' },
        { id: 'review', type: 'gate', label: 'Review the complete campaign' },
        { id: 'images', type: 'workflow', label: 'Prepare campaign images', workflow_id: 'image-generation' },
      ],
    },
  },
  {
    filename: 'managed-review', name: 'Managed editorial review',
    description: 'A disabled definition remains available for inspection.',
    source: 'plugin', pluginId: 'workflows', disabled: true, stepCount: 1,
    definition: {
      name: 'Managed editorial review', description: 'Review the campaign.', version: 1,
      steps: [{ id: 'review', type: 'agent', label: 'Review', agent: 'team:editorial-production-and-brand-review' }],
    },
  },
]

// Codex r5 R5-1: the recovery surfaces in the browser — the list page in skill
// recovery mode (`?recover=1&skill=`) over a skill whose frontmatter does not
// parse, and the raw definition editor for a workflow with an unknown key.
const skillContent = '---\nname: [\nmodel: fast\n---\n\nReview the campaign. The output_schema is described below in prose only.\n'
const definitionYaml = 'name: Editorial launch\ndescription: Coordinate a seasonal campaign.\nversion: 1\nsteps:\n  - id: draft\n    type: agent\n    agent: $assigned\n    bogus: true\n'
const recoveryReport = {
  checks: [
    { checkId: 'workflows.skills', latestExecution: { outcome: 'observed' } },
    { checkId: 'workflows.definitions', latestExecution: { outcome: 'observed' } },
  ],
  observations: [
    { id: 'workflows.skills:frontmatter-review.md', checkId: 'workflows.skills', status: 'warning', summary: 'Skill review.md has frontmatter that does not parse (line 2).', evidence: { section: 'frontmatter', line: 2, code: 'frontmatter-invalid-yaml' } },
    { id: 'workflows.definitions:schema-editorial-launch-0', checkId: 'workflows.definitions', status: 'warning', summary: 'Workflow editorial-launch has unknown YAML keys at steps.0.bogus: Unrecognized key: "bogus"', evidence: { path: 'steps.0.bogus', line: 8 } },
  ],
  incidents: [
    { id: 'workflows:skills:frontmatter-review.md', title: 'Workflow skill review.md has invalid frontmatter', impact: 'Steps that use this skill cannot run.', declarationId: 'frontmatter', observationIds: ['workflows.skills:frontmatter-review.md'], resources: [{ kind: 'file', id: 'review.md' }] },
    { id: 'workflows:definitions:schema-editorial-launch-0', title: 'Workflow editorial-launch has an unknown key', impact: 'Unknown fields are ignored, so the workflow may not behave as its author intended.', declarationId: 'schema', observationIds: ['workflows.definitions:schema-editorial-launch-0'], resources: [{ kind: 'workflow', id: 'editorial-launch' }] },
  ],
}
function RecoveryFixture() {
  return (
    <>
      <WorkflowsPage />
      <section aria-label="Definition recovery" className="px-bakin-4 @md/page-shell:px-bakin-6 @xl/page-shell:px-bakin-8">
        <WorkflowRecoverView resource={{ kind: 'workflow', id: 'editorial-launch' }} target={{ kind: 'definition', id: 'editorial-launch' }} onDismiss={() => {}} />
      </section>
    </>
  )
}
createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost
    fixture={{
      ...DEFAULT_PLUGIN_UI_FIXTURE,
      route: '/workflows?recover=1&skill=review.md',
      randomSeed: 'workflow-rows',
      network: [
        { path: '/api/plugins/workflows/definitions?includeDisabled=1', status: 200, json: { templates } },
        { path: '/api/plugins/health/doctor', status: 200, json: recoveryReport },
        { path: '/api/plugins/workflows/skills/review.md/raw', status: 200, json: { name: 'review.md', path: '/Users/me/.bakin/workflows/skills/review.md', content: skillContent, problems: [{ section: 'frontmatter', message: 'frontmatter is not valid YAML: unexpected end of flow sequence (line 2)' }] } },
        { path: '/api/plugins/workflows/definitions/editorial-launch/raw', status: 200, json: { id: 'editorial-launch', source: 'user', path: '/Users/me/.bakin/workflows/editorial-launch.yaml', yaml: definitionYaml } },
      ],
    }}
    registrations={[{ id: 'workflows', routes: { '/workflows': RecoveryFixture } }]}
  />,
)
