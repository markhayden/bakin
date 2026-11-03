import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'health',
  fixtureEntry: './tests/ui.fixture.tsx',
  // The ownership refusal is a human decision: its card lands on the control (two outcomes, self-healing 1.7).
  readySelector: '[data-incident-id="search-ownership"] a[href*="tab=search"]',
})
