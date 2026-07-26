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

import { chatRoutes } from './lib/routes'
import { registerChatSearch } from './lib/search'
import { getChatSummary, sweepInterruptedTurns } from './lib/store'
import { isTurnInFlight, resolveActiveTurnForAgent, restoreQueues } from './lib/stream-bridge'
import { wireChannelInbound } from './lib/channel-inbound'

let unsubscribeChannelInbound: (() => void) | null = null

const chatPlugin: BakinPlugin = definePlugin({
  id: 'chat',
  name: 'Chat',
  version: '0.2.0',
  routes: chatRoutes,

  settingsSchema: {
    fields: [
      { key: 'toasts', type: 'boolean', label: 'Reply toasts', description: 'Show an in-app toast when an agent replies while you are on another page', default: true },
      { key: 'sound', type: 'boolean', label: 'Reply sound', description: 'Play a soft chime when an agent replies while you are on another page', default: true },
    ],
  },

  activate(ctx: PluginContext) {
    // Transcripts join global search (⌘K finds conversations by content).
    registerChatSearch(ctx)
    // A turn that died with the process (restart/crash) left its user row
    // unanswered with no marker — stamp it honestly so the transcript
    // doesn't look forever-pending (#706). Best-effort, never blocks boot.
    // THEN drain any persisted queued follow-ups (#729, spec D2) — sweep
    // first so the interrupted turn's error row lands before drained rows.
    void sweepInterruptedTurns(isTurnInFlight)
      .then(() => restoreQueues(ctx))
      .catch((err) => ctx.log.error('queued-message restore failed', err as Error))
    // Cross-plugin: lets tools called mid-turn (image generation) bind
    // their output to the agent's current chat without the agent passing ids.
    ctx.hooks.register('chat.resolveActiveTurn', async (data) => {
      const agentId = (data as { agentId?: string })?.agentId
      const active = agentId ? resolveActiveTurnForAgent(agentId) : null
      // Deleted-chat window: a turn can outlive its chat briefly — never
      // bind billable work to a chat that no longer exists.
      if (!active || !getChatSummary(active.chatId)) return null
      return active
    })
    // Inbound channel chat (#669 Phase B): messages from the delivery
    // bridge become real chats; replies post back. Feature-detected —
    // inert on runtimes without an inbound stream. Idempotent for reload.
    unsubscribeChannelInbound?.()
    unsubscribeChannelInbound = wireChannelInbound(ctx)
  },

  onShutdown() {
    unsubscribeChannelInbound?.()
    unsubscribeChannelInbound = null
  },
})

export default chatPlugin
