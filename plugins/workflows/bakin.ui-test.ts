import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'workflows',
  fixtureEntry: './tests/ui.fixture.tsx',
  readySelector: '[data-testid="row-editorial-launch"]',
})
