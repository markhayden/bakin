import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { AgentPulse } from '../components/agent-pulse'
import { HealthTabIntro } from '../components/health-tab-intro'
import { agentEffort, agentHistory, agentSessions, fixtureScan } from './agent-pulse.fixture-data'

const settled = { effort: false, history: false, latestSessions: false, liveNow: false, context: false, settings: false }
function AgentFixture() {
  return <Page><PageHeader title="Health" description="Agent comparison" /><PageBody>
    <HealthTabIntro title="Agents" description="Compare usage, tracked work and review evidence." />
    <AgentPulse effort={agentEffort} history={agentHistory} latestSessions={agentSessions}
      liveNow={{ generatedAt: fixtureScan, runs: [] }} context={null} contextBudgetBytes={null}
      pending={settled} unavailable={{ ...settled, context: true }} errors={[]} onRetry={() => {}} />
  </PageBody></Page>
}
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/health?tab=agents' }}
  registrations={[{ id: 'health', routes: { '/health': AgentFixture } }]}
/> )
