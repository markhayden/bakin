import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'health',
  fixtureEntry: './tests/ui.fixture.tsx',
  readySelector: '[data-testid="installed-plugin-table-scroll"] [data-slot="data-table"]',
})
