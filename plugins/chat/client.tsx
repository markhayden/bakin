/**
 * Chat plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; the page slot is
 * mirrored in `contributes.slots` so the host lazy-loads this client.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { ChatPage } from './components/chat-page'
import { ChatBadgeProvider } from './components/chat-badge-provider'

registerPlugin({
  id: 'chat',
  slots: {
    'page:/chat': ChatPage,
    // Global (outside the router): unread nav badge, tab-title prefix,
    // reply toasts/chime/OS notifications — works from any page.
    'nav-badge-providers': ChatBadgeProvider,
  },
})
