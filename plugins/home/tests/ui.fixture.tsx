import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { HomePage } from '../components/home-page'

// The ready state: the prompt and a full set of starters, one with long copy.
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/home', network: [
    { path: '/api/plugins/home/state', status: 200, json: {
      ok: true,
      state: { name: 'ready', agent: { id: 'main', name: 'Nova' } },
      starters: [
        { id: 'create-image', title: 'Create an image', description: 'Describe what you want; get a few options to choose from', prompt: 'x', needsAttachment: false },
        { id: 'research-topic', title: 'Research a topic', description: 'Name a subject; get a written brief with sources', prompt: 'x', needsAttachment: false },
        { id: 'schedule-recurring', title: 'Schedule a recurring task', description: 'Something that should happen every day or week', prompt: 'x', needsAttachment: false },
        { id: 'summarize-document', title: 'Summarize a document', description: 'Attach a file; get the short version and the action items', prompt: 'x', needsAttachment: true },
        { id: 'goal-into-tasks', title: 'Break a goal into tasks', description: "Say what you're trying to get done; get it on the board", prompt: 'x', needsAttachment: false },
        { id: 'draft-something', title: 'Draft something for me', description: 'An email, a post, an announcement, or anything else that needs words and a reader in mind', prompt: 'x', needsAttachment: false },
      ],
      personalities: [],
      hello: false,
      introductionSkipped: false,
    } },
  ] }}
  registrations={[{ id: 'home', routes: { '/home': HomePage } }]} />)
