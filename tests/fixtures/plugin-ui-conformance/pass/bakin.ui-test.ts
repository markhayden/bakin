import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'fixture-pass',
  fixtureEntry: './fixture.tsx',
  reportDir: './test-results/bakin-ui',
})
