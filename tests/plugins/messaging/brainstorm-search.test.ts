/**
 * Brainstorm search indexer unit tests.
 *
 * Tests the pure functions in `plugins/messaging/lib/brainstorm-search.ts`
 * — `buildDoc`, `parseSessionFile`, and `sessionKey`. These are
 * filesystem-touching helpers (parseSessionFile reads from disk) so the
 * mandatory content-dir mock + temp dir cleanup applies even though no
 * plugin is activated here.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-messaging-search-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ messaging: testDir }),
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

import {
  buildDoc,
  parseSessionFile,
  sessionKey,
  SESSION_FILE_PATTERN,
} from '../../../plugins/messaging/lib/brainstorm-search'
import type { PlanningSession } from '../../../plugins/messaging/types'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeSession(overrides: Partial<PlanningSession> = {}): PlanningSession {
  return {
    id: 'sess-1',
    agentId: 'basil',
    title: 'Week 16 recipes',
    status: 'active',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-09T15:00:00Z',
    messages: [],
    proposals: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// SESSION_FILE_PATTERN
// ---------------------------------------------------------------------------

describe('SESSION_FILE_PATTERN', () => {
  it('targets brainstorm session JSON files under messaging/sessions/', () => {
    expect(SESSION_FILE_PATTERN).toBe('messaging/sessions/*.json')
  })
})

// ---------------------------------------------------------------------------
// sessionKey
// ---------------------------------------------------------------------------

describe('sessionKey', () => {
  it('prefixes with brainstorm-', () => {
    expect(sessionKey('abc123')).toBe('brainstorm-abc123')
  })

  it('handles uuid-shaped ids', () => {
    expect(sessionKey('11111111-2222-3333-4444-555555555555')).toBe(
      'brainstorm-11111111-2222-3333-4444-555555555555',
    )
  })

  it('does not mangle empty string (defensive)', () => {
    expect(sessionKey('')).toBe('brainstorm-')
  })
})

// ---------------------------------------------------------------------------
// buildDoc
// ---------------------------------------------------------------------------

describe('buildDoc', () => {
  it('returns a search document with all expected fields for a populated session', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', role: 'user', content: 'I want spring smoothies', timestamp: '2026-04-01T00:00:00Z' },
        { id: 'm2', role: 'assistant', content: 'Here are some ideas', timestamp: '2026-04-01T00:01:00Z' },
      ],
      proposals: [
        {
          id: 'p1',
          messageId: 'm2',
          revision: 1,
          agentId: 'basil',
          title: 'Mango Lassi',
          scheduledAt: '2026-04-15T09:00:00Z',
          contentType: 'recipe',
          tone: 'energetic',
          brief: 'Sweet, tangy summer drink',
          status: 'proposed',
        },
      ],
    })

    const doc = buildDoc(session)
    expect(doc).toMatchObject({
      session_id: 'sess-1',
      title: 'Week 16 recipes',
      status: 'active',
      agent_id: 'basil',
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-09T15:00:00Z',
    })
    expect(doc.message_body).toContain('I want spring smoothies')
    expect(doc.message_body).toContain('Here are some ideas')
    expect(doc.proposal_summaries).toContain('Mango Lassi')
    expect(doc.proposal_summaries).toContain('Sweet, tangy summer drink')
  })

  it('handles an empty session (no messages, no proposals) without crashing', () => {
    const doc = buildDoc(makeSession())
    expect(doc.session_id).toBe('sess-1')
    expect(doc.message_body).toBe('')
    expect(doc.proposal_summaries).toBe('')
  })

  it('skips empty / non-string message contents', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', role: 'user', content: '', timestamp: '2026-04-01T00:00:00Z' },
        { id: 'm2', role: 'assistant', content: 'real content', timestamp: '2026-04-01T00:01:00Z' },
        // @ts-expect-error — defensively test a malformed content field
        { id: 'm3', role: 'user', content: null, timestamp: '2026-04-01T00:02:00Z' },
      ],
    })
    const doc = buildDoc(session)
    expect(doc.message_body).toBe('real content')
  })

  it('falls back to title-only or brief-only when proposals have a missing field', () => {
    const session = makeSession({
      proposals: [
        {
          id: 'p1', messageId: 'm1', revision: 1, agentId: 'basil',
          title: 'Title Only', scheduledAt: '2026-04-15T09:00:00Z',
          contentType: 'recipe', tone: 'calm', brief: '', status: 'proposed',
        },
        {
          id: 'p2', messageId: 'm1', revision: 1, agentId: 'basil',
          title: '', scheduledAt: '2026-04-15T09:00:00Z',
          contentType: 'recipe', tone: 'calm', brief: 'Brief Only', status: 'proposed',
        },
      ],
    })
    const doc = buildDoc(session)
    const summaries = doc.proposal_summaries as string
    expect(summaries).toContain('Title Only')
    expect(summaries).toContain('Brief Only')
    // Neither should produce a stray colon since one half is missing
    expect(summaries).not.toContain('Title Only:')
    expect(summaries).not.toContain(': Brief Only')
  })

  it('handles missing optional top-level fields', () => {
    // Cast through unknown so we can simulate a session that's missing
    // optional-shaped fields without TypeScript complaining.
    const partial = {
      id: 'sess-2',
      agentId: 'scout',
      messages: [],
      proposals: [],
    } as unknown as PlanningSession
    const doc = buildDoc(partial)
    expect(doc.session_id).toBe('sess-2')
    // String fields coerce to '' so Antfly text indexes don't choke.
    expect(doc.title).toBe('')
    expect(doc.status).toBe('')
    // Datetime fields are omitted when missing — Antfly rejects '' for
    // `datetime` types, so the key simply isn't present on the doc.
    expect(doc.created_at).toBeUndefined()
    expect(doc.updated_at).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// parseSessionFile
// ---------------------------------------------------------------------------

describe('parseSessionFile', () => {
  it('parses a well-formed session JSON file', () => {
    const session = makeSession({ id: 'parse-1', title: 'Parse Me' })
    const path = join(testDir, 'parse-1.json')
    writeFileSync(path, JSON.stringify(session))
    const parsed = parseSessionFile(path)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe('parse-1')
    expect(parsed!.title).toBe('Parse Me')
  })

  it('returns null for a missing file', () => {
    const parsed = parseSessionFile(join(testDir, 'nope.json'))
    expect(parsed).toBeNull()
  })

  it('returns null for a malformed JSON file', () => {
    const path = join(testDir, 'broken.json')
    writeFileSync(path, '{not json at all')
    expect(parseSessionFile(path)).toBeNull()
  })

  it('returns null for JSON without a string id', () => {
    const path = join(testDir, 'no-id.json')
    writeFileSync(path, JSON.stringify({ title: 'oops', messages: [], proposals: [] }))
    expect(parseSessionFile(path)).toBeNull()
  })

  it('defensively defaults missing messages/proposals arrays', () => {
    const path = join(testDir, 'sparse.json')
    writeFileSync(path, JSON.stringify({ id: 'sparse-1', agentId: 'basil', title: 'Sparse' }))
    const parsed = parseSessionFile(path)
    expect(parsed).not.toBeNull()
    expect(Array.isArray(parsed!.messages)).toBe(true)
    expect(Array.isArray(parsed!.proposals)).toBe(true)
    expect(parsed!.messages.length).toBe(0)
    expect(parsed!.proposals.length).toBe(0)
  })
})
