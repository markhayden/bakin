import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'health',
  fixtureEntry: './tests/updates.fixture.tsx',
  readySelector: '[data-update-id="bakin:bakin"]',
  reportDir: 'test-results/bakin-ui-updates',
})
