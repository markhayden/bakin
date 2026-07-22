import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'reference-bookmarks',
  fixtureEntry: './tests/ui.fixture.tsx',
  readySelector: '[data-reference-bookmarks-ready]',
})
