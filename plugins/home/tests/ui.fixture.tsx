import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { HomePage } from '../components/home-page'

createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/home', network: [] }}
  registrations={[{ id: 'home', routes: { '/home': HomePage } }]} />)
