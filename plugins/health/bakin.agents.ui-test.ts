import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'health',
  fixtureEntry: './tests/agent-pulse.fixture.tsx',
  readySelector: '[data-slot="data-table"]',
  reportDir: 'test-results/bakin-ui-agents',
})
