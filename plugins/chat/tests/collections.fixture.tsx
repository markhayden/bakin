import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { PluginUiFixtureHost, DEFAULT_PLUGIN_UI_FIXTURE } from '@makinbakin/sdk/testing/ui'
import { Page, PageHeader, PageBody } from '@makinbakin/sdk/patterns'
import { Launcher } from '../components/launcher'
function Fixture() {
  return <Page data-collection-ready><PageHeader title="Chat" /><PageBody><Launcher loading={false} onOpenChat={() => {}} onStartChat={() => {}} chats={[
    { id: 'review', agentId: 'pixel', title: 'Publication review and planning for the next seasonal campaign', titleSource: 'user', pinned: false, createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-01-15T11:00:00Z', messageCount: 4, unreadCount: 2, lastMessagePreview: 'Keep the latest editorial review with the launch.' },
    { id: 'archive', agentId: 'jessica', title: 'Archive notes', titleSource: 'user', pinned: false, createdAt: '2026-01-15T09:00:00Z', updatedAt: '2026-01-15T10:00:00Z', messageCount: 2, unreadCount: 0 },
  ]} /></PageBody></Page>
}
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/chat' }} registrations={[{ id: 'chat', routes: { '/chat': Fixture } }]} />)
