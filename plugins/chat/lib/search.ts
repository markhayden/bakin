/**
 * Chat search integration (S11) — transcripts join global search as a
 * file-backed content type: one doc per chat (title, agent, recent
 * message text), synced by the watcher on every JSONL append, deep-linked
 * from the ⌘K overlay via /chat/<id>.
 */
import { basename } from 'path'

import type { PluginContext } from '@bakin/core/plugin-types'

import { getChatSummary, listChats, readTranscript } from './store'

/** Body text budget per doc — recent messages win. */
const BODY_MAX_CHARS = 6000

const CHAT_FILE = /^([0-9a-f-]{36})\.jsonl$/i

export function chatFileToId(rel: string): string | null {
  const match = CHAT_FILE.exec(basename(rel))
  return match ? match[1] : null
}

/** Recent user+assistant text, newest-biased, within the byte budget. */
export function chatSearchBody(chatId: string): string {
  const rows = readTranscript(chatId)
  const parts: string[] = []
  let total = 0
  for (let i = rows.length - 1; i >= 0 && total < BODY_MAX_CHARS; i--) {
    const row = rows[i]
    if (row.kind !== 'user' && row.kind !== 'assistant') continue
    const text = row.content.trim()
    if (!text) continue
    parts.push(text)
    total += text.length
  }
  return parts.reverse().join('\n').slice(-BODY_MAX_CHARS)
}

export function chatToSearchDoc(chatId: string): Record<string, unknown> | null {
  const chat = getChatSummary(chatId)
  if (!chat) return null
  return {
    id: chat.id,
    title: chat.title || 'New chat',
    agent_id: chat.agentId,
    body: chatSearchBody(chat.id),
    updated_at: chat.updatedAt,
  }
}

export function registerChatSearch(ctx: PluginContext): void {
  ctx.search.registerFileBackedContentType({
    table: 'chats',
    schemaVersion: 1,
    schema: {
      title: { type: 'text' },
      body: { type: 'text' },
      agent_id: { type: 'keyword' },
      updated_at: { type: 'datetime' },
    },
    searchableFields: ['title', 'body'],
    rerankField: 'body',
    embeddingTemplate: '{{title}} {{body}}',
    facets: ['agent_id'],
    chunker: { enabled: true, targetTokens: 250, overlapTokens: 30 },
    filePatterns: [
      {
        // Transcript JSONLs only — index.json and attachments/ never match.
        pattern: 'chat/*.jsonl',
        fileToId: (rel) => chatFileToId(rel),
        fileToDoc: async (rel) => {
          const chatId = chatFileToId(rel)
          return chatId ? chatToSearchDoc(chatId) : null
        },
      },
    ],
    reindex: async function* () {
      for (const chat of listChats()) {
        const doc = chatToSearchDoc(chat.id)
        if (doc) yield { key: chat.id, doc }
      }
    },
    verifyExists: async (key: string) => getChatSummary(key) !== null,
  })
}
