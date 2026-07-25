/**
 * Chat store — Bakin-owned transcripts under ~/.bakin/chat/.
 *
 * Layout:
 *   chat/index.json                 — { chats: ChatSummary[] } (zod-validated)
 *   chat/<chatId>.jsonl             — ChatTranscriptRow per line, append-only
 *   chat/attachments/<chatId>/      — user-sent images (T6)
 *
 * Index writes are atomic (tmp + rename) and serialized through one queue,
 * mirroring the assets-manifest pattern. All paths resolve lazily through
 * getBakinPaths() so test mocks take effect.
 *
 * Transcript rows are schema v2 (structured tool rows, turnId, aborted).
 * v1 rows parse leniently: old aggregate `"name: summary"` tool strings
 * normalize into summary-only structured rows — no migration files.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
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
import type { ChatQueuedMessage, ChatSummary, ChatTitleSource, ChatTranscriptRow } from '../types'

const log = createLogger('chat-store')

const ChatSummarySchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string(),
  titleSource: z.enum(['fallback', 'llm', 'user']).default('fallback'),
  pinned: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative().default(0),
  lastSeenAt: z.string().optional(),
  lastMessageAt: z.string().optional(),
  lastMessagePreview: z.string().optional(),
})

const ChatIndexSchema = z.object({
  chats: z.array(ChatSummarySchema),
})

const AttachmentSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  path: z.string().min(1),
})

// v2 rows; the tool row's toolName is optional at PARSE time so v1 rows
// (`{ kind:'tool', ts, summary: "name: rest" }`) load — readTranscript
// normalizes them into structured summary-only rows.
const TranscriptRowSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    ts: z.string(),
    content: z.string(),
    attachments: z.array(AttachmentSchema).optional(),
  }),
  z.object({
    kind: z.literal('assistant'),
    ts: z.string(),
    turnId: z.string().optional(),
    content: z.string(),
  }),
  z.object({
    kind: z.literal('tool'),
    ts: z.string(),
    turnId: z.string().optional(),
    callId: z.string().optional(),
    toolName: z.string().optional(),
    status: z.enum(['completed', 'failed']).optional(),
    summary: z.string().optional(),
    inputPreview: z.string().optional(),
    outputPreview: z.string().optional(),
    durationMs: z.number().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('error'),
    ts: z.string(),
    turnId: z.string().optional(),
    message: z.string(),
    errorKind: z.string().optional(),
  }),
  z.object({
    kind: z.literal('aborted'),
    ts: z.string(),
    turnId: z.string().optional(),
  }),
])

/** Derive a chat title from the first user message. */
const TITLE_MAX = 60
const PREVIEW_MAX = 140

function chatDir(): string {
  return getBakinPaths().chat
}

function indexPath(): string {
  return join(chatDir(), 'index.json')
}

function assertChatId(chatId: string): void {
  // chatId is always a server-generated UUID; reject anything else so a
  // crafted id can never traverse out of the chat dir.
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) {
    throw new Error(`invalid chat id: ${chatId}`)
  }
}

function transcriptPath(chatId: string): string {
  assertChatId(chatId)
  return join(chatDir(), `${chatId}.jsonl`)
}

/** Directory for a chat's user-sent attachments. */
export function attachmentsDir(chatId: string): string {
  assertChatId(chatId)
  return join(chatDir(), 'attachments', chatId)
}

// --- Pending queue snapshots (#729) — chat/queue/<chatId>.json -------------

const QueuedMessageSchema = z.object({
  id: z.string().min(1),
  ts: z.string(),
  content: z.string(),
  agentId: z.string().min(1),
  attachments: z.array(AttachmentSchema).optional(),
})

function queueDir(): string {
  return join(chatDir(), 'queue')
}

function queuePath(chatId: string): string {
  assertChatId(chatId)
  return join(queueDir(), `${chatId}.json`)
}

export function readQueue(chatId: string): ChatQueuedMessage[] {
  const path = queuePath(chatId)
  if (!existsSync(path)) return []
  try {
    return z.array(QueuedMessageSchema).parse(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (err) {
    log.error(`queue snapshot unreadable for ${chatId} — treating as empty`, err as Error)
    return []
  }
}

/** Full-snapshot write (the engine's queue.persist hook). Empty = file removed. */
export function writeQueue(chatId: string, items: ChatQueuedMessage[]): Promise<void> {
  return serialized(() => {
    const path = queuePath(chatId)
    if (!items.length) {
      rmSync(path, { force: true })
      return
    }
    mkdirSync(queueDir(), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(items, null, 2))
    renameSync(tmp, path)
  })
}

/** Chat ids with a persisted queue snapshot (boot restore). Never throws —
 *  like the interrupted-turn sweep, a failure here (e.g. a minimal test
 *  context without a chat dir) must not break activation. */
export function listQueuedChatIds(): string[] {
  try {
    if (!existsSync(queueDir())) return []
    return readdirSync(queueDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  } catch (err) {
    log.error('queued-chat listing failed — skipping restore', err as Error)
    return []
  }
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
let pendingWrites: Promise<unknown> = Promise.resolve()

function serialized<T>(fn: () => T): Promise<T> {
  const next = pendingWrites.then(fn)
  pendingWrites = next.catch(() => {})
  return next
}

function writeIndexAtomic(index: { chats: ChatSummary[] }): void {
  ensureChatDir()
  const tmp = `${indexPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(index, null, 2))
  renameSync(tmp, indexPath())
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, PREVIEW_MAX) ?? ''
}

export function listChats(agentId?: string): ChatSummary[] {
  const { chats } = readIndex()
  const filtered = agentId ? chats.filter((c) => c.agentId === agentId) : chats
  return [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })
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
      titleSource: input.title?.trim() ? 'user' : 'fallback',
      pinned: false,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      unreadCount: 0,
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
    rmSync(attachmentsDir(chatId), { recursive: true, force: true })
    rmSync(queuePath(chatId), { force: true })
    return true
  })
}

/** Normalize a v1 aggregate tool row (`"name: summary"`) into the v2 shape. */
function normalizeToolRow(row: {
  ts: string
  turnId?: string
  callId?: string
  toolName?: string
  status?: 'completed' | 'failed'
  summary?: string
  inputPreview?: string
  outputPreview?: string
  durationMs?: number
  metadata?: Record<string, unknown>
}): ChatTranscriptRow {
  if (row.toolName) {
    return { kind: 'tool', ...row, toolName: row.toolName, status: row.status ?? 'completed' }
  }
  const raw = row.summary ?? 'tool'
  const sep = raw.indexOf(': ')
  const toolName = sep > 0 ? raw.slice(0, sep) : raw
  const summary = sep > 0 ? raw.slice(sep + 2) : undefined
  return {
    kind: 'tool',
    ts: row.ts,
    toolName,
    status: 'completed',
    ...(summary ? { summary } : {}),
  }
}

export function readTranscript(chatId: string): ChatTranscriptRow[] {
  const path = transcriptPath(chatId)
  if (!existsSync(path)) return []
  const rows: ChatTranscriptRow[] = []
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = TranscriptRowSchema.parse(JSON.parse(line))
      rows.push(parsed.kind === 'tool' ? normalizeToolRow(parsed) : parsed)
    } catch (err) {
      log.error(`skipping malformed transcript row in ${chatId}`, err as Error)
    }
  }
  return rows
}

/**
 * Append a transcript row and maintain the summary: messageCount counts
 * user+assistant rows, the first user row titles an untitled chat
 * (titleSource 'fallback'), assistant rows bump unreadCount and refresh
 * the last-message preview.
 */
export function appendTranscriptRow(chatId: string, row: ChatTranscriptRow): Promise<void> {
  return serialized(() => {
    const index = readIndex()
    const summary = index.chats.find((c) => c.id === chatId)
    if (!summary) throw new Error(`unknown chat: ${chatId}`)
    appendFileSync(transcriptPath(chatId), `${JSON.stringify(row)}\n`)
    const now = new Date().toISOString()
    if (row.kind === 'user' || row.kind === 'assistant') {
      if (row.kind === 'user' && summary.messageCount === 0 && !summary.title) {
        summary.title = row.content.slice(0, TITLE_MAX)
        summary.titleSource = 'fallback'
      }
      summary.messageCount += 1
      summary.lastMessageAt = row.ts
      summary.lastMessagePreview = firstLine(row.content)
    }
    if (row.kind === 'assistant') {
      summary.unreadCount += 1
    }
    if (row.kind === 'user') {
      // The user is looking at the chat when they send.
      summary.lastSeenAt = now
      summary.unreadCount = 0
    }
    summary.updatedAt = now
    writeIndexAtomic(index)
  })
}

/** The user viewed the chat: clear unread and stamp lastSeenAt. */
export function markSeen(chatId: string): Promise<ChatSummary | null> {
  return serialized(() => {
    const index = readIndex()
    const summary = index.chats.find((c) => c.id === chatId)
    if (!summary) return null
    summary.lastSeenAt = new Date().toISOString()
    summary.unreadCount = 0
    writeIndexAtomic(index)
    return summary
  })
}

/**
 * Set the chat title with source precedence: a user rename always sticks;
 * an LLM title never overwrites a user rename; fallback only fills blanks.
 */
export function setTitle(chatId: string, title: string, source: ChatTitleSource): Promise<ChatSummary | null> {
  return serialized(() => {
    const index = readIndex()
    const summary = index.chats.find((c) => c.id === chatId)
    if (!summary) return null
    const rank: Record<ChatTitleSource, number> = { fallback: 0, llm: 1, user: 2 }
    if (rank[source] < rank[summary.titleSource]) return summary
    const trimmed = title.trim().slice(0, TITLE_MAX * 2)
    if (!trimmed) return summary
    summary.title = trimmed
    summary.titleSource = source
    summary.updatedAt = new Date().toISOString()
    writeIndexAtomic(index)
    return summary
  })
}

export function setPinned(chatId: string, pinned: boolean): Promise<ChatSummary | null> {
  return serialized(() => {
    const index = readIndex()
    const summary = index.chats.find((c) => c.id === chatId)
    if (!summary) return null
    summary.pinned = pinned
    writeIndexAtomic(index)
    return summary
  })
}

/**
 * Boot sweep (#706): any chat whose transcript ends on a user row lost its
 * turn to a process death (the engine's in-flight map dies with the
 * server) — stamp an honest error row so the reply doesn't look pending
 * forever and "Try again" is offered.
 */
export async function sweepInterruptedTurns(): Promise<void> {
  let chats: ChatSummary[]
  try {
    chats = listChats()
  } catch (err) {
    // Never let the sweep break activation (e.g. minimal test contexts
    // without a chat dir) — a missed sweep just waits for the next boot.
    log.error('interrupted-turn sweep could not list chats', err as Error)
    return
  }
  for (const chat of chats) {
    try {
      const rows = readTranscript(chat.id)
      const last = rows[rows.length - 1]
      if (last?.kind !== 'user') continue
      await appendTranscriptRow(chat.id, {
        kind: 'error',
        ts: new Date().toISOString(),
        message: 'Interrupted by a server restart before the reply finished.',
      })
    } catch (err) {
      log.error(`interrupted-turn sweep failed for chat ${chat.id}`, err as Error)
    }
  }
}
