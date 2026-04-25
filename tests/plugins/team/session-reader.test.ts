/**
 * Pure-function tests for plugins/team/lib/session-reader.ts.
 *
 * Strategy: write fixture JSONL files into a tmp OpenClaw home, point
 * the openclaw-home resolver at it, then call readLatestSessionTranscript
 * directly. No HTTP, no React.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-session-reader-${Date.now()}-${randomUUID()}`)
const openclawHome = join(testDir, 'openclaw')
const agentsDir = join(openclawHome, 'agents')

process.env.OPENCLAW_HOME = openclawHome
process.env.BAKIN_HOME = testDir

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openclawHome,
  getOpenClawPath: (...parts: string[]) => join(openclawHome, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => openclawHome,
  getOpenClawPath: (...parts: string[]) => join(openclawHome, ...parts),
  resetOpenClawHome: () => {},
}))

import { readLatestSessionTranscript } from '../../../plugins/team/lib/session-reader'

function writeSession(agentId: string, filename: string, lines: object[]) {
  const sessionDir = join(agentsDir, agentId, 'sessions')
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(
    join(sessionDir, filename),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  )
}

beforeAll(() => {
  mkdirSync(agentsDir, { recursive: true })
})

beforeEach(() => {
  // Clean per-test agent dirs so fixtures don't leak between cases.
  rmSync(agentsDir, { recursive: true, force: true })
  mkdirSync(agentsDir, { recursive: true })
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

describe('readLatestSessionTranscript', () => {
  it('returns null when the agent has no sessions directory', () => {
    expect(readLatestSessionTranscript('ghost')).toBeNull()
  })

  it('returns null when the sessions directory is empty', () => {
    mkdirSync(join(agentsDir, 'pixel', 'sessions'), { recursive: true })
    expect(readLatestSessionTranscript('pixel')).toBeNull()
  })

  it('parses a happy-path session into a structured transcript', () => {
    writeSession('pixel', '2026-04-25.jsonl', [
      { type: 'session', id: 'sess-123', timestamp: '2026-04-25T10:00:00Z' },
      { type: 'message', timestamp: '2026-04-25T10:00:01Z', message: { role: 'system', content: 'You are Pixel.' } },
      { type: 'message', timestamp: '2026-04-25T10:00:05Z', message: { role: 'user', content: 'Hello.' } },
      { type: 'message', timestamp: '2026-04-25T10:00:10Z', message: { role: 'assistant', model: 'claude-opus-4-7', content: 'Hi Mark!' } },
    ])

    const transcript = readLatestSessionTranscript('pixel')
    expect(transcript).not.toBeNull()
    expect(transcript!.sessionId).toBe('sess-123')
    expect(transcript!.sessionStarted).toBe('2026-04-25T10:00:00Z')
    expect(transcript!.totalMessages).toBe(3)
    expect(transcript!.truncated).toBe(false)
    expect(transcript!.messages).toHaveLength(3)
    expect(transcript!.messages[0]).toMatchObject({ role: 'system', content: 'You are Pixel.' })
    expect(transcript!.messages[2]).toMatchObject({ role: 'assistant', model: 'claude-opus-4-7', content: 'Hi Mark!' })
  })

  it('skips malformed JSONL lines without breaking the whole transcript', () => {
    const sessionDir = join(agentsDir, 'pixel', 'sessions')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'mixed.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 'sess-bad', timestamp: '2026-04-25T10:00:00Z' }),
        '{ this is not valid json',
        JSON.stringify({ type: 'message', timestamp: '2026-04-25T10:00:05Z', message: { role: 'user', content: 'survived' } }),
        '',
      ].join('\n'),
    )

    const transcript = readLatestSessionTranscript('pixel')
    expect(transcript!.messages).toHaveLength(1)
    expect(transcript!.messages[0].content).toBe('survived')
  })

  it('truncates to the requested cap and sets truncated=true', () => {
    const lines: object[] = [{ type: 'session', id: 'sess-big', timestamp: '2026-04-25T10:00:00Z' }]
    for (let i = 0; i < 250; i++) {
      lines.push({ type: 'message', timestamp: `2026-04-25T10:${String(i % 60).padStart(2, '0')}:00Z`, message: { role: 'user', content: `msg ${i}` } })
    }
    writeSession('pixel', 'big.jsonl', lines)

    const transcript = readLatestSessionTranscript('pixel', { maxMessages: 50 })
    expect(transcript!.totalMessages).toBe(250)
    expect(transcript!.messages).toHaveLength(50)
    expect(transcript!.truncated).toBe(true)
    // Truncation keeps the most recent — first message in the slice should be msg 200
    expect(transcript!.messages[0].content).toBe('msg 200')
    expect(transcript!.messages[49].content).toBe('msg 249')
  })

  it('picks the most recent session when multiple files exist', () => {
    writeSession('pixel', 'old.jsonl', [
      { type: 'session', id: 'sess-old', timestamp: '2026-04-20T10:00:00Z' },
      { type: 'message', message: { role: 'user', content: 'old session' } },
    ])
    writeSession('pixel', 'new.jsonl', [
      { type: 'session', id: 'sess-new', timestamp: '2026-04-25T10:00:00Z' },
      { type: 'message', message: { role: 'user', content: 'new session' } },
    ])

    const transcript = readLatestSessionTranscript('pixel')
    expect(transcript!.sessionId).toBe('sess-new')
    expect(transcript!.messages[0].content).toBe('new session')
  })

  it('serializes object content as pretty JSON for tool calls', () => {
    writeSession('pixel', 'tool.jsonl', [
      { type: 'session', id: 'sess-tool', timestamp: '2026-04-25T10:00:00Z' },
      {
        type: 'message',
        timestamp: '2026-04-25T10:00:01Z',
        toolName: 'bakin_exec_log',
        message: { role: 'tool', content: { result: 'ok', payload: { nested: true } } },
      },
    ])

    const transcript = readLatestSessionTranscript('pixel')
    expect(transcript!.messages).toHaveLength(1)
    const msg = transcript!.messages[0]
    expect(msg.role).toBe('tool')
    expect(msg.toolName).toBe('bakin_exec_log')
    expect(msg.content).toContain('"result"')
    expect(msg.content).toContain('"nested"')
  })

  it('drops unknown roles silently (forward-compat with new role types)', () => {
    writeSession('pixel', 'mystery.jsonl', [
      { type: 'session', id: 'sess-x', timestamp: '2026-04-25T10:00:00Z' },
      { type: 'message', message: { role: 'user', content: 'kept' } },
      { type: 'message', message: { role: 'wizard', content: 'dropped' } },
    ])

    const transcript = readLatestSessionTranscript('pixel')
    expect(transcript!.messages).toHaveLength(1)
    expect(transcript!.messages[0].content).toBe('kept')
  })
})
