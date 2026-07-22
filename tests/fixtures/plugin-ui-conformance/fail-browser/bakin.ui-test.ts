import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'fixture-fail-browser',
  fixtureEntry: './fixture.tsx',
})
