import { createRoot } from 'react-dom/client'
import { PluginUiFixtureHost, type PluginUiFixtureRegistration } from '@makinbakin/sdk/testing/ui'

function MissingStylesPage() {
  return <p>The fixture deliberately omits the canonical stylesheet.</p>
}

const registrations = [{
  id: 'fixture-fail-stylesheet',
  routes: { '/': MissingStylesPage },
}] satisfies readonly PluginUiFixtureRegistration[]

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost registrations={registrations} />,
)
