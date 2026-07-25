/**
 * Pi session origin labeling (#691): a session file recorded in
 * bakin-threads.json was Bakin-dispatched; an unrecorded file is
 * interactive/external. Missing map = Bakin never dispatched (external);
 * corrupt map = cannot tell (unknown, never guessed).
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-pi-session-origin-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = pathJoin(testDir, 'pi')
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { createMemorySurface, SESSION_TIER_ID, DURABLE_TIER_ID } from '../../packages/adapter-pi/src/memory'
import { getAgentSessionsDir, getAgentWorkspaceDir } from '../../packages/adapter-pi/src/home'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

const AGENT = 'main'

function sessionsDir(): string {
  return getAgentSessionsDir(AGENT)
}

function writeSessionFile(name: string): string {
  const abs = pathJoin(sessionsDir(), name)
  writeFileSync(abs, JSON.stringify({ type: 'session', id: name, timestamp: '2026-07-01T10:00:00Z' }) + '\n')
  return abs
}

function writeThreadMap(threads: Record<string, { sessionId: string; file: string; createdAt: string; updatedAt: string }>): void {
  writeFileSync(pathJoin(sessionsDir(), 'bakin-threads.json'), JSON.stringify({ version: 1, threads }))
}

beforeEach(() => {
  rmSync(sessionsDir(), { recursive: true, force: true })
  mkdirSync(sessionsDir(), { recursive: true })
})

describe('pi session origin metadata (#691)', () => {
  it('labels mapped files bakin (with thread) and unmapped files external', async () => {
    const dispatched = writeSessionFile('dispatched.jsonl')
    writeSessionFile('interactive.jsonl')
    writeThreadMap({
      'task:t1:d1': { sessionId: 's1', file: dispatched, createdAt: 'x', updatedAt: 'x' },
    })

    const entries = await createMemorySurface().listEntries(SESSION_TIER_ID, { agentId: AGENT })
    const byId = new Map(entries.map((e) => [e.id, e]))
    expect(byId.get('dispatched.jsonl')?.metadata).toMatchObject({ origin: 'bakin', originThreadId: 'task:t1:d1' })
    expect(byId.get('interactive.jsonl')?.metadata).toMatchObject({ origin: 'external' })
    expect(byId.get('interactive.jsonl')?.metadata?.originThreadId).toBeUndefined()
  })

  it('no thread map means Bakin never dispatched here — everything external', async () => {
    writeSessionFile('solo.jsonl')
    const entries = await createMemorySurface().listEntries(SESSION_TIER_ID, { agentId: AGENT })
    expect(entries[0]?.metadata).toMatchObject({ origin: 'external' })
  })

  it('a corrupt thread map means unknown for every session, never a guess', async () => {
    writeSessionFile('a.jsonl')
    writeSessionFile('b.jsonl')
    writeFileSync(pathJoin(sessionsDir(), 'bakin-threads.json'), '{ not json')

    const entries = await createMemorySurface().listEntries(SESSION_TIER_ID, { agentId: AGENT })
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      expect(entry.metadata).toMatchObject({ origin: 'unknown' })
    }
  })

  it('getEntry carries the same origin metadata as the listing', async () => {
    const dispatched = writeSessionFile('dispatched.jsonl')
    writeThreadMap({
      'chat:abc': { sessionId: 's1', file: dispatched, createdAt: 'x', updatedAt: 'x' },
    })
    const entry = await createMemorySurface().getEntry(SESSION_TIER_ID, 'dispatched.jsonl', { agentId: AGENT })
    expect(entry?.metadata).toMatchObject({ origin: 'bakin', originThreadId: 'chat:abc' })
  })

  it('durable-tier entries stay origin-free', async () => {
    mkdirSync(getAgentWorkspaceDir(AGENT), { recursive: true })
    writeFileSync(pathJoin(getAgentWorkspaceDir(AGENT), 'SOUL.md'), 'soul')
    const entries = await createMemorySurface().listEntries(DURABLE_TIER_ID, { agentId: AGENT })
    expect(entries[0]?.metadata).toBeUndefined()
  })
})
