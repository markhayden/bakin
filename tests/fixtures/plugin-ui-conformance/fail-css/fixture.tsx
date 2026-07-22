import '@makinbakin/sdk/styles.css'
import './plugin.css'

import { createRoot } from 'react-dom/client'
import { PluginUiFixtureHost, type PluginUiFixtureRegistration } from '@makinbakin/sdk/testing/ui'

function UnsafePage() {
  return <p>Unsafe document selector fixture</p>
}

const registrations = [{
  id: 'fixture-fail-css',
  routes: { '/': UnsafePage },
}] satisfies readonly PluginUiFixtureRegistration[]

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost registrations={registrations} />,
)
