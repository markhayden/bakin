/**
 * sessions.list/get read the gateway's per-agent sessions.json store (T28)
 * — mapping, per-agent filtering, sessionId dedupe, and ordering.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-oc-sessions-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = join(testDir, 'bakin')

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ db: join(testDir, 'bakin', 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ db: join(testDir, 'bakin', 'bakin.db') }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}))

import { listOpenClawSessions, getOpenClawSession } from '../../packages/adapter-openclaw/src/sessions'
import { __resetSessionStoreCacheForTest } from '../../packages/adapter-openclaw/src/session-store'

const MAIN_ID = '35eb60fd-c022-413d-85c2-f1ab0a02d058'
const PIXEL_ID = 'a111d257-1111-4111-8111-111111111111'

function writeStore(agentId: string, store: Record<string, unknown>): void {
  const dir = join(testDir, 'openclaw', 'agents', agentId, 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'sessions.json'), JSON.stringify(store))
}

beforeAll(() => {
  writeStore('main', {
    'agent:main:main': {
      sessionId: MAIN_ID,
      updatedAt: 1_783_733_248_334,
      sessionStartedAt: 1_783_641_787_099,
      model: 'gpt-5.5',
      chatType: 'direct',
      totalTokens: 96_355,
      origin: { label: 'm.hayden direct chat' },
      skillsSnapshot: { huge: 'ignored' },
    },
    // A resumed key pointing at the SAME session, older write — dedupe
    // must keep the newer entry above.
    [`agent:main:explicit:${MAIN_ID}`]: {
      sessionId: MAIN_ID,
      updatedAt: 1_783_700_000_000,
      sessionStartedAt: 1_783_641_787_099,
    },
    // No sessionId → not a listable session.
    'agent:main:broken': { updatedAt: 1_783_000_000_000 },
  })
  writeStore('pixel', {
    [`agent:pixel:explicit:${PIXEL_ID}`]: {
      sessionId: PIXEL_ID,
      updatedAt: 1_783_800_000_000,
      sessionStartedAt: 1_783_790_000_000,
      sessionFile: join(testDir, 'openclaw', 'agents', 'pixel', 'sessions', 'custom-file.jsonl'),
      model: 'mock-model',
    },
  })
})

afterAll(() => {
  __resetSessionStoreCacheForTest()
  rmSync(testDir, { recursive: true, force: true })
})

describe('listOpenClawSessions', () => {
  it('maps store entries to RuntimeSessions with title/timing/metadata', () => {
    const sessions = listOpenClawSessions('main')
    expect(sessions).toHaveLength(1)
    const s = sessions[0]
    expect(s.id).toBe(MAIN_ID)
    expect(s.agentId).toBe('main')
    expect(s.title).toBe('m.hayden direct chat')
    expect(s.startedAt).toBe(new Date(1_783_641_787_099).toISOString())
    expect(s.updatedAt).toBe(new Date(1_783_733_248_334).toISOString())
    expect(s.metadata).toMatchObject({
      sessionKey: 'agent:main:main',
      model: 'gpt-5.5',
      chatType: 'direct',
      totalTokens: 96_355,
    })
    expect(String(s.metadata?.path)).toEndWith(`${MAIN_ID}.jsonl`)
  })

  it('dedupes multiple keys per sessionId keeping the newest write', () => {
    const [s] = listOpenClawSessions('main')
    // The older explicit-key entry (no origin.label) must not win.
    expect(s.title).toBe('m.hayden direct chat')
  })

  it('lists all agents sorted by updatedAt desc and honors sessionFile', () => {
    const sessions = listOpenClawSessions()
    expect(sessions.map((s) => s.id)).toEqual([PIXEL_ID, MAIN_ID])
    expect(String(sessions[0].metadata?.path)).toEndWith('custom-file.jsonl')
    // Key-derived title when origin.label is absent.
    expect(sessions[0].title).toBe(`agent:pixel:explicit:${PIXEL_ID}`)
  })

  it('returns empty for unknown agents and missing stores', () => {
    expect(listOpenClawSessions('nope')).toEqual([])
  })
})

describe('getOpenClawSession', () => {
  it('finds a session by id across agents', () => {
    const s = getOpenClawSession(PIXEL_ID)
    expect(s?.agentId).toBe('pixel')
  })

  it('returns null for unknown ids', () => {
    expect(getOpenClawSession(randomUUID())).toBeNull()
  })
})
