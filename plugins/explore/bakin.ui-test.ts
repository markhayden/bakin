import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'
export default definePluginUiConformance({ pluginId: 'explore', fixtureEntry: './tests/ui.fixture.tsx', readySelector: '[data-slot="data-table"]' })
