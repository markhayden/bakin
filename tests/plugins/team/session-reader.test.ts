/**
 * Pure-function tests for plugins/team/lib/session-reader.ts.
 *
 * Strategy: feed fixture JSONL through a mock runtime memory adapter and call
 * readLatestSessionTranscript directly. No HTTP, no React, no runtime files.
 */
import { describe, expect, it } from 'bun:test'
import type { RuntimeMemoryEntry } from '@bakin/core/adapters/runtime'

import { readLatestSessionTranscript } from '../../../plugins/team/lib/session-reader'

interface FixtureSession {
  id: string
  content: string
  updatedAt?: string
}

function lines(entries: object[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
}

function runtimeMemory(sessions: FixtureSession[]) {
  return {
    listTiers: async () => [{
      id: 'runtime-session-jsonl',
      label: 'Session transcripts',
      metadata: { sourceKind: 'session_jsonl' },
    }],
    listEntries: async (tierId: string, opts?: { agentId?: string }): Promise<RuntimeMemoryEntry[]> => sessions.map((session) => ({
      id: session.id,
      tierId,
      agentId: opts?.agentId,
      content: '',
      updatedAt: session.updatedAt,
    })),
    getEntry: async (tierId: string, id: string, opts?: { agentId?: string }): Promise<RuntimeMemoryEntry | null> => {
      const session = sessions.find((entry) => entry.id === id)
      if (!session) return null
      return {
        id: session.id,
        tierId,
        agentId: opts?.agentId,
        content: session.content,
        updatedAt: session.updatedAt,
      }
    },
  }
}

describe('readLatestSessionTranscript', () => {
  it('returns null when the agent has no runtime session entries', async () => {
    expect(await readLatestSessionTranscript(runtimeMemory([]), 'ghost')).toBeNull()
  })

  it('parses a happy-path session into a structured transcript', async () => {
    const transcript = await readLatestSessionTranscript(runtimeMemory([{
      id: '2026-04-25',
      content: lines([
        { type: 'session', id: 'sess-123', timestamp: '2026-04-25T10:00:00Z' },
        { type: 'message', timestamp: '2026-04-25T10:00:01Z', message: { role: 'system', content: 'You are Pixel.' } },
        { type: 'message', timestamp: '2026-04-25T10:00:05Z', message: { role: 'user', content: 'Hello.' } },
        { type: 'message', timestamp: '2026-04-25T10:00:10Z', message: { role: 'assistant', model: 'claude-opus-4-7', content: 'Hi Mark!' } },
      ]),
    }]), 'pixel')

    expect(transcript).not.toBeNull()
    expect(transcript!.sessionId).toBe('sess-123')
    expect(transcript!.sessionStarted).toBe('2026-04-25T10:00:00Z')
    expect(transcript!.totalMessages).toBe(3)
    expect(transcript!.truncated).toBe(false)
    expect(transcript!.messages).toHaveLength(3)
    expect(transcript!.messages[0]).toMatchObject({ role: 'system', content: 'You are Pixel.' })
    expect(transcript!.messages[2]).toMatchObject({ role: 'assistant', model: 'claude-opus-4-7', content: 'Hi Mark!' })
  })

  it('skips malformed JSONL lines without breaking the whole transcript', async () => {
    const transcript = await readLatestSessionTranscript(runtimeMemory([{
      id: 'mixed',
      content: [
        JSON.stringify({ type: 'session', id: 'sess-bad', timestamp: '2026-04-25T10:00:00Z' }),
        '{ this is not valid json',
        JSON.stringify({ type: 'message', timestamp: '2026-04-25T10:00:05Z', message: { role: 'user', content: 'survived' } }),
        '',
      ].join('\n'),
    }]), 'pixel')

    expect(transcript!.messages).toHaveLength(1)
    expect(transcript!.messages[0].content).toBe('survived')
  })

  it('truncates to the requested cap and sets truncated=true', async () => {
    const entries: object[] = [{ type: 'session', id: 'sess-big', timestamp: '2026-04-25T10:00:00Z' }]
    for (let i = 0; i < 250; i++) {
      entries.push({ type: 'message', timestamp: `2026-04-25T10:${String(i % 60).padStart(2, '0')}:00Z`, message: { role: 'user', content: `msg ${i}` } })
    }

    const transcript = await readLatestSessionTranscript(runtimeMemory([
      { id: 'big', content: lines(entries) },
    ]), 'pixel', { maxMessages: 50 })

    expect(transcript!.totalMessages).toBe(250)
    expect(transcript!.messages).toHaveLength(50)
    expect(transcript!.truncated).toBe(true)
    expect(transcript!.messages[0].content).toBe('msg 200')
    expect(transcript!.messages[49].content).toBe('msg 249')
  })

  it('picks the most recent session by first JSONL timestamp', async () => {
    const transcript = await readLatestSessionTranscript(runtimeMemory([
      {
        id: 'old',
        content: lines([
          { type: 'session', id: 'sess-old', timestamp: '2026-04-20T10:00:00Z' },
          { type: 'message', message: { role: 'user', content: 'old session' } },
        ]),
      },
      {
        id: 'new',
        content: lines([
          { type: 'session', id: 'sess-new', timestamp: '2026-04-25T10:00:00Z' },
          { type: 'message', message: { role: 'user', content: 'new session' } },
        ]),
      },
    ]), 'pixel')

    expect(transcript!.sessionId).toBe('sess-new')
    expect(transcript!.messages[0].content).toBe('new session')
  })

  it('falls back to runtime updatedAt when the first JSONL line has no timestamp', async () => {
    const transcript = await readLatestSessionTranscript(runtimeMemory([
      {
        id: 'old',
        updatedAt: '2026-04-20T10:00:00Z',
        content: lines([
          { type: 'session', id: 'sess-old' },
          { type: 'message', message: { role: 'user', content: 'old session' } },
        ]),
      },
      {
        id: 'new',
        updatedAt: '2026-04-25T10:00:00Z',
        content: lines([
          { type: 'session', id: 'sess-new' },
          { type: 'message', message: { role: 'user', content: 'new session' } },
        ]),
      },
    ]), 'pixel')

    expect(transcript!.sessionId).toBe('sess-new')
  })

  it('serializes object content as pretty JSON for tool calls', async () => {
    const transcript = await readLatestSessionTranscript(runtimeMemory([{
      id: 'tool',
      content: lines([
        { type: 'session', id: 'sess-tool', timestamp: '2026-04-25T10:00:00Z' },
        {
          type: 'message',
          timestamp: '2026-04-25T10:00:01Z',
          toolName: 'bakin_exec_log',
          message: { role: 'tool', content: { result: 'ok', payload: { nested: true } } },
        },
      ]),
    }]), 'pixel')

    expect(transcript!.messages).toHaveLength(1)
    const msg = transcript!.messages[0]
    expect(msg.role).toBe('tool')
    expect(msg.toolName).toBe('bakin_exec_log')
    expect(msg.content).toContain('"result"')
    expect(msg.content).toContain('"nested"')
  })

  it('drops unknown roles silently', async () => {
    const transcript = await readLatestSessionTranscript(runtimeMemory([{
      id: 'mystery',
      content: lines([
        { type: 'session', id: 'sess-x', timestamp: '2026-04-25T10:00:00Z' },
        { type: 'message', message: { role: 'user', content: 'kept' } },
        { type: 'message', message: { role: 'wizard', content: 'dropped' } },
      ]),
    }]), 'pixel')

    expect(transcript!.messages).toHaveLength(1)
    expect(transcript!.messages[0].content).toBe('kept')
  })
})
