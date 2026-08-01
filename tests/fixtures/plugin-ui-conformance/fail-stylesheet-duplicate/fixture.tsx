import '@makinbakin/sdk/styles.css'
import '@makinbakin/sdk/styles.css'
import './plugin.css'

import { createRoot } from 'react-dom/client'
import { PluginUiFixtureHost, type PluginUiFixtureRegistration } from '@makinbakin/sdk/testing/ui'

function CopiedStylesPage() {
  return <p>The fixture deliberately imports and copies canonical styles.</p>
}

const registrations = [{
  id: 'fixture-fail-stylesheet-copy',
  routes: { '/': CopiedStylesPage },
}] satisfies readonly PluginUiFixtureRegistration[]

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost registrations={registrations} />,
)
