/**
 * Chat plugin — client entry point.
 * Nav is declared in bakin-plugin.json `contributes.nav`; the page slot is
 * mirrored in `contributes.slots` so the host lazy-loads this client.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { ChatPage } from './components/chat-page'

registerPlugin({
  id: 'chat',
  slots: {
    'page:/chat': ChatPage,
  },
})
