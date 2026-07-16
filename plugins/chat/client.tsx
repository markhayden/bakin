/**
 * Chat plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; the page slot is
 * mirrored in `contributes.slots` so the host lazy-loads this client.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { ChatPage } from './components/chat-page'
import { ChatBadgeProvider } from './components/chat-badge-provider'

// Named wrappers so each slot binds its page mode statically (component
// identity stays stable across renders).
function ChatListPage() {
  return <ChatPage />
}
function ChatDetailPage({ chatId }: { chatId?: string }) {
  return <ChatPage chatId={chatId} />
}
function ChatDraftPage() {
  return <ChatPage draft />
}

registerPlugin({
  id: 'chat',
  slots: {
    'page:/chat': ChatListPage,
    'page:/chat/[chatId]': ChatDetailPage,
    'page:/chat/new': ChatDraftPage,
    // Global (outside the router): unread nav badge, tab-title prefix,
    // reply toasts/chime/OS notifications — works from any page.
    'nav-badge-providers': ChatBadgeProvider,
  },
  search: {
    hitRenderers: {
      chats: (hit) => ({
        title: String(hit.fields.title ?? 'New chat'),
        subtitle: `chat · ${String(hit.fields.agent_id ?? '')}`,
        href: `/chat/${encodeURIComponent(hit.id)}`,
        icon: 'message-square',
      }),
    },
  },
})
