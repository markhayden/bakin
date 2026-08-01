import '@makinbakin/sdk/styles.css'
import './plugin.css'

import { createRoot } from 'react-dom/client'
import { PluginUiFixtureHost, type PluginUiFixtureRegistration } from '@makinbakin/sdk/testing/ui'

function BrokenPage() {
  console.error('Seeded fixture console failure')
  return (
    <div className="fixture-fail-browser__overflow">
      <h1>Broken conformance fixture</h1>
      <button className="fixture-fail-browser__unnamed" type="button" />
      <button type="button" tabIndex={-1}>Keyboard-locked action</button>
    </div>
  )
}

const registrations = [{
  id: 'fixture-fail-browser',
  routes: { '/': BrokenPage },
}] satisfies readonly PluginUiFixtureRegistration[]

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost registrations={registrations} />,
)
