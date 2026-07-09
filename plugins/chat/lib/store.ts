/**
 * Chat store — Bakin-owned transcripts under ~/.bakin/chat/.
 *
 * Layout:
 *   chat/index.json      — { chats: ChatSummary[] } (zod-validated)
 *   chat/<chatId>.jsonl  — ChatTranscriptRow per line, append-only
 *
 * Index writes are atomic (tmp + rename) and serialized through one queue,
 * mirroring the assets-manifest pattern. All paths resolve lazily through
 * getBakinPaths() so test mocks take effect.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { z } from 'zod'

import { getBakinPaths } from '../../../src/core/content-dir'
import { createLogger } from '../../../src/core/logger'
import type { ChatSummary, ChatTranscriptRow } from '../types'

const log = createLogger('chat-store')

const ChatSummarySchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number().int().nonnegative(),
})

const ChatIndexSchema = z.object({
  chats: z.array(ChatSummarySchema),
})

const TranscriptRowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), ts: z.string(), content: z.string() }),
  z.object({ kind: z.literal('assistant'), ts: z.string(), content: z.string() }),
  z.object({ kind: z.literal('tool'), ts: z.string(), summary: z.string() }),
  z.object({ kind: z.literal('error'), ts: z.string(), message: z.string(), errorKind: z.string().optional() }),
])

/** Derive a chat title from the first user message. */
const TITLE_MAX = 60

function chatDir(): string {
  return getBakinPaths().chat
}

function indexPath(): string {
  return join(chatDir(), 'index.json')
}

function transcriptPath(chatId: string): string {
  // chatId is always a server-generated UUID; reject anything else so a
  // crafted id can never traverse out of the chat dir.
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) {
    throw new Error(`invalid chat id: ${chatId}`)
  }
  return join(chatDir(), `${chatId}.jsonl`)
}

function ensureChatDir(): void {
  if (!existsSync(chatDir())) mkdirSync(chatDir(), { recursive: true })
}

function readIndex(): { chats: ChatSummary[] } {
  if (!existsSync(indexPath())) return { chats: [] }
  try {
    return ChatIndexSchema.parse(JSON.parse(readFileSync(indexPath(), 'utf-8')))
  } catch (err) {
    log.error('chat index unreadable — starting from empty', err as Error)
    return { chats: [] }
  }
}

// One writer at a time: every mutation runs through this queue so
// concurrent route handlers can't interleave read-modify-write cycles.
let writeQueue: Promise<unknown> = Promise.resolve()

function serialized<T>(fn: () => T): Promise<T> {
  const next = writeQueue.then(fn)
  writeQueue = next.catch(() => {})
  return next
}

function writeIndexAtomic(index: { chats: ChatSummary[] }): void {
  ensureChatDir()
  const tmp = `${indexPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(index, null, 2))
  renameSync(tmp, indexPath())
}

export function listChats(agentId?: string): ChatSummary[] {
  const { chats } = readIndex()
  const filtered = agentId ? chats.filter((c) => c.agentId === agentId) : chats
  return [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getChatSummary(chatId: string): ChatSummary | null {
  return readIndex().chats.find((c) => c.id === chatId) ?? null
}

export function createChat(input: { agentId: string; title?: string }): Promise<ChatSummary> {
  return serialized(() => {
    const now = new Date().toISOString()
    const summary: ChatSummary = {
      id: randomUUID(),
      agentId: input.agentId,
      title: input.title?.trim() || '',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    }
    const index = readIndex()
    index.chats.push(summary)
    writeIndexAtomic(index)
    writeFileSync(transcriptPath(summary.id), '')
    return summary
  })
}

export function deleteChat(chatId: string): Promise<boolean> {
  return serialized(() => {
    const index = readIndex()
    const before = index.chats.length
    index.chats = index.chats.filter((c) => c.id !== chatId)
    if (index.chats.length === before) return false
    writeIndexAtomic(index)
    rmSync(transcriptPath(chatId), { force: true })
    return true
  })
}

export function readTranscript(chatId: string): ChatTranscriptRow[] {
  const path = transcriptPath(chatId)
  if (!existsSync(path)) return []
  const rows: ChatTranscriptRow[] = []
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(TranscriptRowSchema.parse(JSON.parse(line)))
    } catch (err) {
      log.error(`skipping malformed transcript row in ${chatId}`, err as Error)
    }
  }
  return rows
}

/**
 * Append a transcript row and maintain the summary (messageCount counts
 * user+assistant rows; the first user row titles an untitled chat).
 */
export function appendTranscriptRow(chatId: string, row: ChatTranscriptRow): Promise<void> {
  return serialized(() => {
    const index = readIndex()
    const summary = index.chats.find((c) => c.id === chatId)
    if (!summary) throw new Error(`unknown chat: ${chatId}`)
    appendFileSync(transcriptPath(chatId), `${JSON.stringify(row)}\n`)
    if (row.kind === 'user' || row.kind === 'assistant') {
      if (row.kind === 'user' && summary.messageCount === 0 && !summary.title) {
        summary.title = row.content.slice(0, TITLE_MAX)
      }
      summary.messageCount += 1
    }
    summary.updatedAt = new Date().toISOString()
    writeIndexAtomic(index)
  })
}
