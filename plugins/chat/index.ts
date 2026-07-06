/**
 * Chat plugin — server entry point.
 *
 * Direct conversations with agents from the Bakin UI. Runtime-agnostic:
 * everything flows through ctx.runtime.messaging with threadId
 * `chat:<chatId>`; transcripts persist Bakin-side under ~/.bakin/chat/.
 *
 * Thin definePlugin shell: routes live in lib/routes.ts, the store in
 * lib/store.ts, the stream bridge in lib/stream-bridge.ts.
 */
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'

const chatPlugin: BakinPlugin = definePlugin({
  id: 'chat',
  name: 'Chat',
  version: '0.1.0',
  // routes land in C2 (lib/routes.ts) once the store-backed handlers exist

  activate(_ctx: PluginContext) {
    // Routes are declarative; nothing to register imperatively yet.
  },
}) as unknown as BakinPlugin

export default chatPlugin
