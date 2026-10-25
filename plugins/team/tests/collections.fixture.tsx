import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { PluginUiFixtureHost, DEFAULT_PLUGIN_UI_FIXTURE } from '@makinbakin/sdk/testing/ui'
import { Page, PageHeader, PageBody } from '@makinbakin/sdk/patterns'
import { TeamManager } from '../components/team-manager'
import { LessonToggleList } from '../components/lesson-toggle-list'
import { RosterRecoverPanel } from '../components/roster-recover-panel'
import { useAgentStore } from '@makinbakin/sdk/hooks'
useAgentStore.setState({ teams: [{ id: 'editorial-publication-review-and-approval', label: 'Editorial publication review and approval', reportsTo: 'pixel' }] })
function Fixture() {
  // Codex r5 R5-1: the roster recovery surface — a duplicated MAIN agent (registry handoff, no Remove) and an id-less entry (registry handoff + Recheck).
  return <Page data-collection-ready><PageHeader title="Team management" /><PageBody><section><h2>Roster recovery</h2><RosterRecoverPanel onDismiss={() => {}} /></section><section><h2>Team settings</h2><TeamManager /></section><LessonToggleList agentId="pixel" /></PageBody></Page>
}
const rosterReport = {
  checks: [{ checkId: 'team.agent-roster', latestExecution: { outcome: 'observed' } }],
  observations: [
    { id: 'team.agent-roster:duplicate-main', checkId: 'team.agent-roster', status: 'warning', summary: 'Runtime agent id main appears 2 times (roster positions 1, 2).', evidence: { kind: 'duplicate', agentId: 'main', positions: [0, 1], names: ['main', 'main'], removable: false, registry: { path: '/Users/me/.pi/agent/bakin-agents.json', entryKeys: ['agents[0]', 'agents[1]'] } } },
    { id: 'team.agent-roster:missing-id-3', checkId: 'team.agent-roster', status: 'warning', summary: 'Runtime agent at roster position 4 has no id.', evidence: { kind: 'missing-id', rosterIndex: 3, name: 'Editorial reviewer', workspace: '/Users/me/.pi/agent/editorial-reviewer', registry: { path: '/Users/me/.pi/agent/bakin-agents.json', entryKey: 'agents[3]' } } },
  ],
  incidents: [
    { id: 'team:roster:duplicate-main', title: 'Runtime agent id main is duplicated', impact: 'Dispatch cannot tell the entries apart.', observationIds: ['team.agent-roster:duplicate-main'], resources: [{ kind: 'agent', id: 'main', label: 'main' }] },
    { id: 'team:roster:missing-id-3', title: 'Roster entry 4 has no id', impact: 'The entry cannot be dispatched to.', observationIds: ['team.agent-roster:missing-id-3'], resources: [{ kind: 'runtime', id: 'roster-entry-3', label: 'roster entry 4' }] },
  ],
}
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/team?recover=1', network: [
  { path: '/api/plugins/health/doctor', status: 200, json: rosterReport },
  { path: '/api/agent-packages/pixel/lessons', status: 200, json: { ok: true, packageId: 'editorial-publication-review@1.0.0', lessons: [
    { lessonId: 'publication-review-and-attribution-guidelines', title: 'Keep review evidence with every published campaign', tags: ['editorial', 'review'], defaultEnabled: true, enabled: true },
    { lessonId: 'archival-notes', title: 'Archive old campaigns', tags: [], defaultEnabled: false, enabled: false },
  ] } },
] }} registrations={[{ id: 'team', routes: { '/team': Fixture } }]} />)
