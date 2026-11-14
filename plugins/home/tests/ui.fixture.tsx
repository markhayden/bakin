import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { AgentFaceSourceContext } from '../components/agent-face'
import { HomePage } from '../components/home-page'

// The fixture runs without the host's files: the pig is a small inline picture here.
const PIG = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="34" r="24" fill="#f0368c"/><circle cx="24" cy="30" r="3" fill="#2a1420"/><circle cx="40" cy="30" r="3" fill="#2a1420"/><path d="M24 42c5 5 11 5 16 0" stroke="#2a1420" stroke-width="3" fill="none" stroke-linecap="round"/></svg>')}`

const NOW = Date.parse(DEFAULT_PLUGIN_UI_FIXTURE.fixedNow)
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()
const HOUR = 60 * 60 * 1000

// The everyday Home of a person who has been at it a while: area cards, recent activity,
// the starters not tried yet (one with long copy), and the upgrades panel.
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/home', network: [
    { path: '/api/plugins/home/state', status: 200, json: {
      ok: true,
      state: { name: 'ready', agent: { id: 'main', name: 'Nova' } },
      starters: [
        { id: 'schedule-reminder', title: 'Schedule a reminder', description: "Tell me once and I'll nudge you when it matters.", prompt: 'x', needsAttachment: false },
        { id: 'research-topic', title: 'Research a topic', description: "Name a subject and I'll come back with a brief, the sources I used, and the questions still worth asking.", prompt: 'x', needsAttachment: false },
        { id: 'goal-into-tasks', title: 'Break a goal into tasks', description: "Say what you're trying to get done and I'll put it on the board.", prompt: 'x', needsAttachment: false },
      ],
      personalities: [],
      firstDay: false,
      person: 'Mark',
      introductionSkipped: false,
      suggestions: [
        { id: 'web-search', title: 'Let your agents search the web', payoff: 'Research with current facts and sources, not only what the model remembers.', action: { label: 'Add web search', href: '/explore?tab=capabilities&item=skill-pack:web-search-brave' } },
        { id: 'add-agent', title: 'Add a specialist to your team', payoff: 'A researcher, a developer or an image artist your main agent can hand work to.', action: { label: 'Browse agents', href: '/explore?tab=agents' } },
      ],
      suggestionCount: 2,
    } },
    { path: '/api/plugins/tasks/', status: 200, json: { columns: {
      backlog: [{ id: 't1', title: 'Write the launch email', updatedAt: NOW - 5 * HOUR }],
      todo: [],
      inProgress: [{ id: 't2', title: 'Draft the pricing page copy with three variants for review', updatedAt: NOW - 2 * HOUR }],
      review: [{ id: 't3', title: 'Pick a hero image', updatedAt: NOW - 3 * HOUR }],
      blocked: [],
      done: [{ id: 't4', title: 'Collect competitor pricing', updatedAt: NOW - 30 * HOUR }],
      archived: [],
    } } },
    { path: '/api/plugins/chat/chats', status: 200, json: { chats: [
      { id: 'c1', title: 'Avatar ideas for Nova', updatedAt: iso(-HOUR), lastMessagePreview: 'Done, option 3 is now my avatar.' },
    ] } },
    {
      path: `/api/plugins/schedule/occurrences?from=${encodeURIComponent(iso(0))}&to=${encodeURIComponent(iso(WEEK_MS))}`,
      status: 200,
      json: { occurrences: [{ at: iso(20 * HOUR), past: false }, { at: iso(44 * HOUR), past: false }] },
    },
    { path: '/api/plugins/schedule/', status: 200, json: { jobs: [{ id: 'j1' }] } },
    { path: '/api/plugins/projects/', status: 404, json: { error: 'not found' } },
  ] }}
  registrations={[{ id: 'home', routes: { '/home': () => <AgentFaceSourceContext value={PIG}><HomePage /></AgentFaceSourceContext> } }]} />)
