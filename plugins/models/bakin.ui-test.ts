import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'models',
  fixtureEntry: './tests/ui.fixture.tsx',
  readySelector: '[data-testid="overview-stats"]',
})
