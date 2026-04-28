/**
 * Tests for plugins/memory/lib/tier-parsers/session-parser.ts.
 *
 * Session rows represent one session surfaced through runtime memory.
 * Runtime adapters may satisfy that from provider APIs or from on-disk
 * `agents/<id>/sessions/sessions.json` data. Both sources feed the same
 * parser.
 *
 * Parser contract (see types.ts § SessionMetaSchema):
 *   one session object → one MemoryRow with tier='session'.
 *   id: session:<16-char-sha256(agent|sessionKey)>
 *   kind: parsed from sessionKey (format `agent:<agent>:<kind>[:...]`).
 */
import { describe, it, expect, mock } from 'bun:test'

// Defensive isolation — pure parser, but shared module init touches logger etc.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-session-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
mock.module('../../../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-session-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
mock.module('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { parseSession } from '../../../../plugins/memory/lib/tier-parsers/session-parser'
import { MemoryRowSchema, SessionMetaSchema } from '../../../../plugins/memory/lib/types'

/**
 * Builds a session object shaped like `sessions.json` entries on disk.
 * Keep this in sync with the real shape documented in the rebuild spec.
 */
function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: '8e1f8ee8-9851-4901-aa42-7b706246baab',
    updatedAt: 1773953098141,
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
    contextTokens: 18000,
    cacheRead: 0,
    cacheWrite: 100,
    model: 'claude-opus-4-6',
    modelProvider: 'anthropic',
    abortedLastRun: false,
    origin: {
      label: 'Main agent loop',
      provider: 'anthropic',
      surface: 'cli',
      chatType: 'agent',
      from: null,
      to: null,
      accountId: null,
    },
    sessionFile: '/Users/x/.openclaw/agents/chef/sessions/8e1f8ee8.jsonl',
    ...overrides,
  }
}

describe('parseSession (happy path)', () => {
  it('produces a valid MemoryRow with tier=session for a well-formed session', () => {
    const row = parseSession('chef', 'agent:chef:main', makeSession(), '/path/to/sessions.json')
    expect(row).not.toBeNull()
    if (!row) return

    const validated = MemoryRowSchema.parse(row)
    expect(validated.tier).toBe('session')
    expect(validated.agent).toBe('chef')
    expect(validated.title).toBe('agent:chef:main')
    expect(validated.sourceRef.backend).toBe('runtime')
    expect(validated.sourceRef.path).toBe('/path/to/sessions.json')
  })

  it('populates SessionMeta with sessionKey, sessionId, kind, tokens, model, and origin', () => {
    const row = parseSession('chef', 'agent:chef:main', makeSession(), '/path/to/sessions.json')
    if (!row) throw new Error('expected row')

    const meta = SessionMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.sessionKey).toBe('agent:chef:main')
    expect(meta.sessionId).toBe('8e1f8ee8-9851-4901-aa42-7b706246baab')
    expect(meta.kind).toBe('main')
    expect(meta.inputTokens).toBe(1000)
    expect(meta.outputTokens).toBe(200)
    expect(meta.totalTokens).toBe(1200)
    expect(meta.contextTokens).toBe(18000)
    expect(meta.model).toBe('claude-opus-4-6')
    expect(meta.modelProvider).toBe('anthropic')
    expect(meta.abortedLastRun).toBe(false)
    expect(meta.origin?.label).toBe('Main agent loop')
    expect(meta.origin?.chatType).toBe('agent')
  })

  it('derives kind from sessionKey for openai-flavored keys', () => {
    const row = parseSession(
      'chef',
      'agent:chef:openai:039ebbaf-20a2-4dd1-988c-686dc5098005',
      makeSession(),
      '/s.json',
    )
    if (!row) throw new Error('expected row')
    const meta = SessionMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.kind).toBe('openai')
  })

  it('derives kind from sessionKey for discord-channel keys', () => {
    const row = parseSession(
      'chef',
      'agent:chef:discord:channel:1483917792745885768',
      makeSession(),
      '/s.json',
    )
    if (!row) throw new Error('expected row')
    const meta = SessionMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.kind).toBe('discord')
  })

  it('uses updatedAt as the row updatedAt/endedAt when present', () => {
    const row = parseSession('chef', 'agent:chef:main', makeSession(), '/s.json')
    if (!row) throw new Error('expected row')
    expect(row.updatedAt).toBe(1773953098141)
    const meta = SessionMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.endedAt).toBe(1773953098141)
  })
})

describe('parseSession (stable id)', () => {
  it('produces the same id for the same (agent, sessionKey) pair', () => {
    const a = parseSession('chef', 'agent:chef:main', makeSession(), '/a.json')
    const b = parseSession('chef', 'agent:chef:main', makeSession({ inputTokens: 9999 }), '/b.json')
    if (!a || !b) throw new Error('expected rows')
    expect(a.id).toBe(b.id)
    expect(a.id).toMatch(/^session:[0-9a-f]{16}$/)
  })

  it('produces different ids for different agents', () => {
    const a = parseSession('chef', 'agent:chef:main', makeSession(), '/a.json')
    const b = parseSession('pixel', 'agent:pixel:main', makeSession(), '/a.json')
    if (!a || !b) throw new Error('expected rows')
    expect(a.id).not.toBe(b.id)
  })

  it('produces different ids for different sessionKeys within the same agent', () => {
    const a = parseSession('chef', 'agent:chef:main', makeSession(), '/a.json')
    const b = parseSession(
      'chef',
      'agent:chef:openai:039ebbaf-20a2-4dd1-988c-686dc5098005',
      makeSession({ sessionId: 'other' }),
      '/a.json',
    )
    if (!a || !b) throw new Error('expected rows')
    expect(a.id).not.toBe(b.id)
  })
})

describe('parseSession (validation)', () => {
  it('returns null when sessionId is missing', () => {
    const bad = makeSession()
    delete (bad as Record<string, unknown>).sessionId
    expect(parseSession('chef', 'agent:chef:main', bad, '/s.json')).toBeNull()
  })

  it('returns null when sessionKey is empty', () => {
    expect(parseSession('chef', '', makeSession(), '/s.json')).toBeNull()
  })

  it('returns null when raw is not a plain object', () => {
    expect(parseSession('chef', 'agent:chef:main', null, '/s.json')).toBeNull()
    expect(parseSession('chef', 'agent:chef:main', 'string', '/s.json')).toBeNull()
    expect(parseSession('chef', 'agent:chef:main', 42, '/s.json')).toBeNull()
  })

  it('falls back to kind="unknown" for sessionKeys that do not match the conventional prefix', () => {
    const row = parseSession('chef', 'weird-key-no-colons', makeSession(), '/s.json')
    if (!row) throw new Error('expected row')
    const meta = SessionMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.kind).toBe('unknown')
  })
})

describe('parseSession (missing-field tolerance)', () => {
  it('accepts a session with nullable numeric fields absent', () => {
    const minimal = {
      sessionId: 'x',
      // no tokens, no model — mimics a newly-created session row.
    }
    const row = parseSession('chef', 'agent:chef:main', minimal, '/s.json')
    if (!row) throw new Error('expected row')
    const meta = SessionMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.inputTokens).toBeNull()
    expect(meta.outputTokens).toBeNull()
    expect(meta.totalTokens).toBeNull()
    expect(meta.model).toBeNull()
    expect(meta.modelProvider).toBeNull()
    expect(meta.origin).toBeNull()
  })

  it('sets status to "unknown" when the upstream object has no status field', () => {
    const row = parseSession('chef', 'agent:chef:main', makeSession(), '/s.json')
    if (!row) throw new Error('expected row')
    const meta = SessionMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.status).toBe('unknown')
  })

  it('populates status when the upstream object provides it', () => {
    const row = parseSession(
      'chef',
      'agent:chef:main',
      makeSession({ status: 'active' }),
      '/s.json',
    )
    if (!row) throw new Error('expected row')
    const meta = SessionMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.status).toBe('active')
  })
})

describe('parseSession (snippet + content)', () => {
  it('writes the sessionKey as the title and includes model + token summary in the snippet', () => {
    const row = parseSession('chef', 'agent:chef:main', makeSession(), '/s.json')
    if (!row) throw new Error('expected row')
    expect(row.title).toBe('agent:chef:main')
    expect(row.snippet).toContain('claude-opus-4-6')
    expect(row.snippet).toContain('1200') // totalTokens surfaced for the search preview
  })
})
