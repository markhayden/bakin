import '@makinbakin/sdk/styles.css'

import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { WorkflowsPage } from '../components/workflows-page'
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

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost
    fixture={{
      ...DEFAULT_PLUGIN_UI_FIXTURE,
      route: '/workflows',
      randomSeed: 'workflow-rows',
      network: [{ path: '/api/plugins/workflows/definitions?includeDisabled=1', status: 200, json: { templates } }],
    }}
    registrations={[{ id: 'workflows', routes: { '/workflows': WorkflowsPage } }]}
  />,
)
