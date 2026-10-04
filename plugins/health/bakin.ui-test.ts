import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'health',
  fixtureEntry: './tests/ui.fixture.tsx',
  readySelector: '[data-incident-id="search-ownership"] button[data-variant="outline"][aria-expanded="true"]',
})
