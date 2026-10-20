import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'health',
  fixtureEntry: './tests/updates.fixture.tsx',
  readySelector: '[data-testid="updates-available"] [data-slot="list-row"]',
  reportDir: 'test-results/bakin-ui-updates',
})
