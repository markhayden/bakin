import type { RuntimeChatChunk } from '@makinbakin/sdk/types'
import {
  foldConversation,
  type ConversationChunk,
  type ConversationMessage,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'

const runtimeChunks: readonly RuntimeChatChunk[] = [
  { type: 'status', content: 'thinking' },
  { type: 'text', content: 'Ready.' },
  { type: 'done' },
]
const acceptedChunks: readonly ConversationChunk[] = runtimeChunks
const messages: readonly ConversationMessage[] = [
  { kind: 'user', ts: '2026-07-20T12:00:00.000Z', content: 'Start' },
]
const turns: ConversationTurn[] = foldConversation(messages, { liveChunks: acceptedChunks })

void turns
