import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'
export default definePluginUiConformance({ pluginId: 'chat', fixtureEntry: './tests/collections.fixture.tsx', readySelector: '[data-collection-ready]' })
