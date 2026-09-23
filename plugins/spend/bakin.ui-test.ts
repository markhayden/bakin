import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'spend',
  fixtureEntry: './tests/ui.fixture.tsx',
  readySelector: '[data-testid="spend-pace"]',
})
