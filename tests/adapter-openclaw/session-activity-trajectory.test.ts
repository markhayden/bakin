/**
 * Session-activity streaming source (P5.3 regression).
 *
 * Newer OpenClaw batches session-JSONL records to turn END but appends the
 * `<sessionId>.trajectory.jsonl` live — tailing the session file made every
 * tool chunk arrive in one burst at turn completion (reproduced live). The
 * watcher must prefer the trajectory when it exists, parse its
 * tool.call/tool.result records, and never replay prior runs.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-session-activity-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = join(testDir, 'bakin')

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ tasks: join(testDir, 'bakin', 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ tasks: join(testDir, 'bakin', 'tasks') }),
}))

import {
  createOpenClawSessionActivityCursor,
  readOpenClawSessionActivity,
  resolveOpenClawSessionActivityFile,
  openClawCliSessionId,
  __resetSessionStoreCacheForTest,
} from '../../packages/adapter-openclaw/src/session-activity'
import { activityChunksFromOpenClawTranscriptRecord } from '../../packages/adapter-openclaw/src/activity-summary'

const AGENT = 'main'
const SESSION_KEY = 'chat:regression'
const sessionsDir = () => join(testDir, 'openclaw', 'agents', AGENT, 'sessions')
const cliId = () => openClawCliSessionId(AGENT, SESSION_KEY)
const trajectoryPath = () => join(sessionsDir(), `${cliId()}.trajectory.jsonl`)
const sessionPath = () => join(sessionsDir(), `${cliId()}.jsonl`)

function seedStore(): void {
  writeFileSync(join(sessionsDir(), 'sessions.json'), JSON.stringify({
    [`agent:${AGENT}:explicit:${cliId()}`]: { sessionId: cliId() },
  }))
}

function trajectoryRecord(type: string, ts: string, data: Record<string, unknown>): string {
  return `${JSON.stringify({ traceSchema: 'openclaw-trajectory', schemaVersion: 1, type, ts, data })}\n`
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(sessionsDir(), { recursive: true })
  __resetSessionStoreCacheForTest()
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('resolveOpenClawSessionActivityFile', () => {
  it('prefers the trajectory file when it exists', () => {
    seedStore()
    writeFileSync(sessionPath(), '')
    writeFileSync(trajectoryPath(), '')
    expect(resolveOpenClawSessionActivityFile(AGENT, SESSION_KEY)).toBe(trajectoryPath())
  })

  it('falls back to the session file when no trajectory exists', () => {
    seedStore()
    writeFileSync(sessionPath(), '')
    expect(resolveOpenClawSessionActivityFile(AGENT, SESSION_KEY)).toBe(sessionPath())
  })
})

describe('trajectory record parsing', () => {
  it('tool.call → running tool chunk', () => {
    const chunks = activityChunksFromOpenClawTranscriptRecord({
      type: 'tool.call',
      ts: '2026-07-09T00:00:01.000Z',
      data: { toolCallId: 'call_1', name: 'bash', arguments: { command: 'ls' } },
    })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].type).toBe('tool')
    const data = chunks[0].data as Record<string, unknown>
    expect(data.phase).toBe('call')
    expect(data.toolName).toBe('bash')
    expect(data.callId).toBe('call_1')
    expect(data.status).toBe('running')
  })

  it('tool.result → result tool chunk; isError wins over status', () => {
    const ok = activityChunksFromOpenClawTranscriptRecord({
      type: 'tool.result',
      ts: '2026-07-09T00:00:02.000Z',
      data: { toolCallId: 'call_1', name: 'bash', status: 'completed', isError: false, result: { exitCode: 0 } },
    })
    expect((ok[0].data as Record<string, unknown>).status).toBe('completed')

    const failed = activityChunksFromOpenClawTranscriptRecord({
      type: 'tool.result',
      ts: '2026-07-09T00:00:03.000Z',
      data: { toolCallId: 'call_2', name: 'bash', status: 'completed', isError: true, result: {} },
    })
    expect((failed[0].data as Record<string, unknown>).status).toBe('failed')
  })
})

describe('live tail over the trajectory', () => {
  it('yields chunks appended after cursor creation, mid-turn', () => {
    seedStore()
    writeFileSync(trajectoryPath(), trajectoryRecord('tool.call', '2020-01-01T00:00:00.000Z', { name: 'old', toolCallId: 'old' }))

    const cursor = createOpenClawSessionActivityCursor(AGENT, SESSION_KEY)
    expect(cursor.sessionFile).toBe(trajectoryPath())
    expect(readOpenClawSessionActivity(AGENT, SESSION_KEY, cursor)).toEqual([])

    const now = new Date(Date.now() + 1000).toISOString()
    appendFileSync(trajectoryPath(), trajectoryRecord('tool.call', now, { name: 'bash', toolCallId: 'c1', arguments: {} }))
    const first = readOpenClawSessionActivity(AGENT, SESSION_KEY, cursor)
    expect(first).toHaveLength(1)
    expect((first[0].data as Record<string, unknown>).phase).toBe('call')

    appendFileSync(trajectoryPath(), trajectoryRecord('tool.result', now, { name: 'bash', toolCallId: 'c1', status: 'completed', result: { exitCode: 0 } }))
    const second = readOpenClawSessionActivity(AGENT, SESSION_KEY, cursor)
    expect(second).toHaveLength(1)
    expect((second[0].data as Record<string, unknown>).phase).toBe('result')
  })

  it('upgrades a sticky session-file pick when the trajectory appears mid-turn', () => {
    // Fresh sessions write the session .jsonl BEFORE the trajectory file —
    // the first resolution lands on the batch-written session file and,
    // without the upgrade, tails it for the whole turn (live P5.3 repro).
    seedStore()
    writeFileSync(sessionPath(), '')
    const cursor = createOpenClawSessionActivityCursor(AGENT, SESSION_KEY)
    expect(cursor.sessionFile).toBe(sessionPath())
    expect(readOpenClawSessionActivity(AGENT, SESSION_KEY, cursor)).toEqual([])

    const now = new Date(Date.now() + 1000).toISOString()
    writeFileSync(trajectoryPath(), trajectoryRecord('tool.call', now, { name: 'bash', toolCallId: 'live', arguments: {} }))
    const chunks = readOpenClawSessionActivity(AGENT, SESSION_KEY, cursor)
    expect(cursor.sessionFile).toBe(trajectoryPath())
    expect(chunks).toHaveLength(1)
    expect((chunks[0].data as Record<string, unknown>).callId).toBe('live')
  })

  it('lazy resolution (trajectory appears mid-turn) never replays prior runs', () => {
    // No store entry and no files at cursor creation — brand-new session.
    const cursor = createOpenClawSessionActivityCursor(AGENT, SESSION_KEY)
    expect(cursor.sessionFile).toBeUndefined()

    // Session materializes mid-turn with an OLD run's records plus a current one.
    seedStore()
    const past = '2020-01-01T00:00:00.000Z'
    const now = new Date(Date.now() + 1000).toISOString()
    writeFileSync(trajectoryPath(),
      trajectoryRecord('tool.call', past, { name: 'stale', toolCallId: 'stale' })
      + trajectoryRecord('tool.call', now, { name: 'bash', toolCallId: 'fresh', arguments: {} }))

    const chunks = readOpenClawSessionActivity(AGENT, SESSION_KEY, cursor)
    expect(chunks).toHaveLength(1)
    expect((chunks[0].data as Record<string, unknown>).callId).toBe('fresh')
  })
})
