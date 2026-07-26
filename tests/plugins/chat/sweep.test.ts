/**
 * Interrupted-turn boot sweep (#706, #735) — the false-stamp guard suite.
 *
 * Pure fs fixtures, zero timing: every case is "write a transcript shape,
 * run the sweep, assert the stamp (or its absence)". The sweep's contract:
 *   rule 1 — tail user row → stamped in every era (turnId-less);
 *   rule 2 — marker era only: tail agent-side content row (turnId, kind
 *            not terminal) → stamped with that turnId;
 *   never  — terminal tails, turnId-less non-user tails, legacy
 *            transcripts (no markerEra, no done row), live turns.
 */
import { describe, test, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-chat-sweep-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    chat: join(testDir, 'chat'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  appendTranscriptRow,
  createChat,
  readTranscript,
  sweepInterruptedTurns,
} from '../../../plugins/chat/lib/store'
import type { ChatTranscriptRow } from '../../../plugins/chat/types'
import type { ConversationTurnRow } from '../../../src/core/conversation-turns'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

const ts = () => new Date().toISOString()
const user = (content: string): ChatTranscriptRow => ({ kind: 'user', ts: ts(), content })
const assistant = (turnId: string | undefined, content: string): ChatTranscriptRow =>
  ({ kind: 'assistant', ts: ts(), ...(turnId ? { turnId } : {}), content })
const tool = (turnId: string): ChatTranscriptRow =>
  ({ kind: 'tool', ts: ts(), turnId, toolName: 'bash', status: 'completed', summary: 'ls' })
const done = (turnId: string): ChatTranscriptRow => ({ kind: 'done', ts: ts(), turnId })

async function makeChat(rows: ChatTranscriptRow[], opts?: { legacy?: boolean }) {
  const chat = await createChat({ agentId: 'main' })
  if (opts?.legacy) {
    // A pre-#735 index entry has NO markerEra key at all — the zod default
    // parses it back as false.
    const idxPath = join(testDir, 'chat', 'index.json')
    const idx = JSON.parse(readFileSync(idxPath, 'utf-8')) as { chats: Array<Record<string, unknown>> }
    for (const c of idx.chats) if (c.id === chat.id) delete c.markerEra
    writeFileSync(idxPath, JSON.stringify(idx))
  }
  for (const row of rows) await appendTranscriptRow(chat.id, row)
  return chat
}

const errorRows = (chatId: string) => readTranscript(chatId).filter((r) => r.kind === 'error')

describe('interrupted-turn sweep (#735)', () => {
  test('rule 1: tail user row → turnId-less stamp with the no-reply wording (marker era and legacy alike)', async () => {
    const markerChat = await makeChat([user('answer me')])
    const legacyChat = await makeChat([user('me too')], { legacy: true })
    await sweepInterruptedTurns()

    for (const chat of [markerChat, legacyChat]) {
      const stamps = errorRows(chat.id)
      expect(stamps).toHaveLength(1)
      expect(stamps[0]).toMatchObject({ message: 'Interrupted — the server stopped before the agent could reply.' })
      expect((stamps[0] as { turnId?: string }).turnId).toBeUndefined()
    }
  })

  test('rule 2: marker-era partial tail (assistant or tool) → stamped with the tail turnId and the truncated-reply wording', async () => {
    const textTail = await makeChat([user('q'), assistant('t1', 'partial rep')])
    const toolTail = await makeChat([user('q'), tool('t2')])
    await sweepInterruptedTurns()

    expect(errorRows(textTail.id)).toEqual([
      expect.objectContaining({ turnId: 't1', message: 'Interrupted — the server stopped before this reply finished.' }),
    ])
    expect(errorRows(toolTail.id)).toEqual([expect.objectContaining({ turnId: 't2' })])
  })

  test('terminal tails (done / aborted / error) are never stamped', async () => {
    const doneTail = await makeChat([user('q'), assistant('t1', 'full reply'), done('t1')])
    const abortedTail = await makeChat([user('q'), assistant('t1', 'partial'), { kind: 'aborted', ts: ts(), turnId: 't1' }])
    const errorTail = await makeChat([user('q'), { kind: 'error', ts: ts(), turnId: 't1', message: 'boom' }])
    await sweepInterruptedTurns()

    expect(errorRows(doneTail.id)).toHaveLength(0)
    expect(errorRows(abortedTail.id)).toHaveLength(0)
    expect(errorRows(errorTail.id)).toHaveLength(1) // only the pre-existing row
  })

  test('empty-reply completed turn: the done row prevents the FALSE rule-1 stamp legacy chats still suffer', async () => {
    // Runtime settled cleanly with zero agent rows — tail would be the user
    // row. In the marker era the done row is the tail instead: untouched.
    const chat = await makeChat([user('q'), done('t1')])
    await sweepInterruptedTurns()
    expect(errorRows(chat.id)).toHaveLength(0)
  })

  test('legacy transcripts: truncated-looking tails are left alone (a completed legacy turn is never falsely marked)', async () => {
    const truncated = await makeChat([user('q'), assistant('t1', 'looks cut off')], { legacy: true })
    const turnIdLessError = await makeChat([user('q'), assistant(undefined, 'old reply'), { kind: 'error', ts: ts(), message: 'old stamp' }], { legacy: true })
    await sweepInterruptedTurns()

    expect(errorRows(truncated.id)).toHaveLength(0)
    expect(errorRows(turnIdLessError.id)).toHaveLength(1) // untouched
  })

  test('marker-era chat with a turnId-less agent tail (legacy rows after upgrade) is left alone', async () => {
    const chat = await makeChat([user('q'), assistant(undefined, 'legacy-shaped reply')])
    await sweepInterruptedTurns()
    expect(errorRows(chat.id)).toHaveLength(0)
  })

  test('idempotency: a second boot never double-stamps — both stamp shapes', async () => {
    const rule1 = await makeChat([user('unanswered')])
    const rule2 = await makeChat([user('q'), assistant('t9', 'partial')])
    await sweepInterruptedTurns()
    await sweepInterruptedTurns()

    expect(errorRows(rule1.id)).toHaveLength(1)
    expect(errorRows(rule2.id)).toHaveLength(1)
  })

  test('crash mid-drain: multi-user prefix + partial assistant → stamped with the drain turnId, rule 1 does not fire', async () => {
    const chat = await makeChat([
      user('first'),
      assistant('t1', 'first reply'),
      done('t1'),
      user('queued A'),
      user('queued B'),
      assistant('t2', 'combined reply cut sho'),
    ])
    await sweepInterruptedTurns()
    expect(errorRows(chat.id)).toEqual([expect.objectContaining({ turnId: 't2' })])
  })

  test('empty and fresh transcripts are untouched (every fresh chat meets the sweep on every boot)', async () => {
    const chat = await createChat({ agentId: 'main' })
    await sweepInterruptedTurns()
    expect(readTranscript(chat.id)).toHaveLength(0)
  })

  test('a broken chat never stops the sweep — later chats still get stamped', async () => {
    // A transcript path that throws on read (EISDIR): the per-chat catch
    // must swallow it and keep sweeping.
    const broken = await createChat({ agentId: 'main' })
    rmSync(join(testDir, 'chat', `${broken.id}.jsonl`))
    mkdirSync(join(testDir, 'chat', `${broken.id}.jsonl`))
    const interrupted = await makeChat([user('still needs a stamp')])

    await sweepInterruptedTurns()
    expect(errorRows(interrupted.id)).toHaveLength(1)
    rmSync(join(testDir, 'chat', `${broken.id}.jsonl`), { recursive: true, force: true })
  })

  test('in-flight chats are skipped — the void-fired activation sweep never stamps a live turn', async () => {
    const live = await makeChat([user('being answered right now')])
    await sweepInterruptedTurns((chatId) => chatId === live.id)
    expect(errorRows(live.id)).toHaveLength(0)
    // Next boot (turn settled or died for real) it is fair game again.
    await sweepInterruptedTurns()
    expect(errorRows(live.id)).toHaveLength(1)
  })

  test('every engine row kind round-trips through the chat store — no silent zod drops', async () => {
    // One row per ENGINE kind, typed as the engine union: if chat\'s schema
    // ever misses a kind, readTranscript drops it and this count breaks
    // (the engine→chat one-way parity pin; the compile-time half is the
    // assignment below).
    const engineRows: ConversationTurnRow[] = [
      { kind: 'user', ts: ts(), content: 'hi' },
      { kind: 'assistant', ts: ts(), turnId: 'p1', content: 'reply' },
      { kind: 'tool', ts: ts(), turnId: 'p1', toolName: 'bash', status: 'completed', summary: 'ls' },
      { kind: 'error', ts: ts(), turnId: 'p1', message: 'boom', errorKind: 'session_lost' },
      { kind: 'aborted', ts: ts(), turnId: 'p1' },
      { kind: 'done', ts: ts(), turnId: 'p1' },
    ]
    const asChatRows: ChatTranscriptRow[] = engineRows // compile-time: engine rows always parse in chat
    const chat = await makeChat(asChatRows)
    expect(readTranscript(chat.id)).toHaveLength(engineRows.length)
  })
})
