/**
 * OpenClaw session origin labeling (#691): sessions.json key shapes carry
 * provenance. Deterministic v5 explicit keys are Bakin sends; subagent
 * sessions are runtime-spawned child work; :main / channels / external
 * clients are interactive. Missing store or unmatched session = unknown.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-oc-session-origin-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
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

import { listOpenClawMemoryEntries } from '../../packages/adapter-openclaw/src/memory'
import {
  deterministicUuid,
  openClawExplicitSessionKey,
  __resetSessionStoreCacheForTest,
} from '../../packages/adapter-openclaw/src/session-store'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

const AGENT = 'nemo'
const SESSIONS_DIR = pathJoin(testDir, 'openclaw', 'agents', AGENT, 'sessions')
const TIER = 'openclaw-session-jsonl'

function writeSessionFile(sessionId: string): void {
  writeFileSync(pathJoin(SESSIONS_DIR, `${sessionId}.jsonl`), '{"type":"session"}\n')
}

function writeStore(entries: Record<string, { sessionId: string }>): void {
  writeFileSync(pathJoin(SESSIONS_DIR, 'sessions.json'), JSON.stringify(entries))
}

beforeEach(() => {
  rmSync(SESSIONS_DIR, { recursive: true, force: true })
  mkdirSync(SESSIONS_DIR, { recursive: true })
  __resetSessionStoreCacheForTest()
})

function originOf(sessionId: string): unknown {
  const entries = listOpenClawMemoryEntries(TIER, { agentId: AGENT })
  return entries.find((e) => e.id === sessionId)?.metadata?.origin
}

describe('openclaw session origin metadata (#691)', () => {
  it('deterministic v5 explicit sessions are bakin-originated', () => {
    const cliId = deterministicUuid(`bakin:${AGENT}:task:t1:d1`)
    writeSessionFile(cliId)
    writeStore({ [openClawExplicitSessionKey(AGENT, cliId)]: { sessionId: cliId } })
    expect(originOf(cliId)).toBe('bakin')
  })

  it('main, channel, external-client, and v4-explicit sessions are external', () => {
    // randomUUID() is v4 — the shape external clients supply.
    const mainId = randomUUID()
    const discordId = randomUUID()
    const openaiId = randomUUID()
    const v4Explicit = randomUUID()
    for (const id of [mainId, discordId, openaiId, v4Explicit]) writeSessionFile(id)
    writeStore({
      [`agent:${AGENT}:main`]: { sessionId: mainId },
      [`agent:${AGENT}:discord:channel:general`]: { sessionId: discordId },
      [`agent:${AGENT}:openai:${openaiId}`]: { sessionId: openaiId },
      [openClawExplicitSessionKey(AGENT, v4Explicit)]: { sessionId: v4Explicit },
    })
    expect(originOf(mainId)).toBe('external')
    expect(originOf(discordId)).toBe('external')
    expect(originOf(openaiId)).toBe('external')
    expect(originOf(v4Explicit)).toBe('external')
  })

  it('subagent sessions are runtime-spawned child work, not operator chat', () => {
    const subId = randomUUID()
    writeSessionFile(subId)
    writeStore({ [`agent:${AGENT}:subagent:${subId}`]: { sessionId: subId } })
    expect(originOf(subId)).toBe('bakin')
  })

  it('a session missing from the store is unknown, never guessed', () => {
    const orphanId = randomUUID()
    writeSessionFile(orphanId)
    writeStore({})
    expect(originOf(orphanId)).toBe('unknown')
  })

  it('an absent sessions.json makes every session unknown', () => {
    const id = randomUUID()
    writeSessionFile(id)
    expect(originOf(id)).toBe('unknown')
  })
})
