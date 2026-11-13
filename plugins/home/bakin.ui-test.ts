import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'
export default definePluginUiConformance({ pluginId: 'home', fixtureEntry: './tests/ui.fixture.tsx', readySelector: '[data-archetype="page"]' })
