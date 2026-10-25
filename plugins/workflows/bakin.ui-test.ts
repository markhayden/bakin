import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'workflows',
  fixtureEntry: './tests/ui.fixture.tsx',
  readySelector: 'section[aria-label="Definition recovery"] [data-testid="workflow-recover-editor"]',
})
