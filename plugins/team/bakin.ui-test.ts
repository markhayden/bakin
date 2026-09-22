import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'
export default definePluginUiConformance({ pluginId: 'team', fixtureEntry: './tests/collections.fixture.tsx', readySelector: '[data-collection-ready]' })
