import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { PluginUiFixtureHost, DEFAULT_PLUGIN_UI_FIXTURE } from '@makinbakin/sdk/testing/ui'
import { Page, PageHeader, PageBody } from '@makinbakin/sdk/patterns'
import { TeamManager } from '../components/team-manager'
import { LessonToggleList } from '../components/lesson-toggle-list'
import { useAgentStore } from '@makinbakin/sdk/hooks'
useAgentStore.setState({ teams: [{ id: 'editorial-publication-review-and-approval', label: 'Editorial publication review and approval', reportsTo: 'pixel' }] })
function Fixture() {
  return <Page data-collection-ready><PageHeader title="Team management" /><PageBody><section><h2>Team settings</h2><TeamManager /></section><LessonToggleList agentId="pixel" /></PageBody></Page>
}
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/team', network: [
  { path: '/api/agent-packages/pixel/lessons', status: 200, json: { ok: true, packageId: 'editorial-publication-review@1.0.0', lessons: [
    { lessonId: 'publication-review-and-attribution-guidelines', title: 'Keep review evidence with every published campaign', tags: ['editorial', 'review'], defaultEnabled: true, enabled: true },
    { lessonId: 'archival-notes', title: 'Archive old campaigns', tags: [], defaultEnabled: false, enabled: false },
  ] } },
] }} registrations={[{ id: 'team', routes: { '/team': Fixture } }]} />)
