/**
 * Tests for plugins/memory/lib/types.ts — Zod schemas for MemoryRow and per-tier meta.
 */
import { describe, it, expect, mock } from 'bun:test'

// Mandatory mocks (CLAUDE.md test isolation). Types-only test, no FS touch,
// but the mock enforcement hook requires these regardless.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => '/tmp/bakin-types-test',
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => '/tmp/bakin-types-test',
  getBakinPaths: () => ({}),
}))

import {
  MEMORY_TIERS,
  MemoryRowSchema,
  SourceRefSchema,
  SessionMetaSchema,
  TurnMetaSchema,
  CheckpointMetaSchema,
  DailyNoteMetaSchema,
  DreamMetaSchema,
  DurableMetaSchema,
  AuditMetaSchema,
} from '../../../plugins/memory/lib/types'

describe('MEMORY_TIERS', () => {
  it('contains the 7 spec-defined tiers', () => {
    expect(MEMORY_TIERS).toEqual([
      'session',
      'turn',
      'checkpoint',
      'daily_note',
      'dream',
      'durable',
      'audit',
    ])
  })
})

describe('SourceRefSchema', () => {
  it('requires backend and path', () => {
    const ok = SourceRefSchema.safeParse({
      backend: 'runtime',
      path: '/tmp/foo.md',
      file: 'foo.md',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects invalid backend', () => {
    const bad = SourceRefSchema.safeParse({ backend: 'other', path: '/x', file: 'x' })
    expect(bad.success).toBe(false)
  })

  it('accepts optional session/event/checkpoint ids and byte offset', () => {
    const parsed = SourceRefSchema.safeParse({
      backend: 'runtime',
      path: '/tmp/s.jsonl',
      file: 's.jsonl',
      sessionId: 'sess-1',
      eventId: 'evt-1',
      checkpointId: 'cp-1',
      offset: 42,
    })
    expect(parsed.success).toBe(true)
  })
})

describe('MemoryRowSchema', () => {
  const base = {
    id: 'audit:abc',
    tier: 'audit' as const,
    agent: 'main',
    title: 'title',
    snippet: 'snip',
    content: 'body',
    sourceRef: { backend: 'bakin' as const, path: '/tmp/audit.jsonl', file: 'audit.jsonl' },
    updatedAt: 1000,
    createdAt: 1000,
    meta: '{}',
  }

  it('accepts a valid row', () => {
    expect(MemoryRowSchema.safeParse(base).success).toBe(true)
  })

  it('rejects unknown tier', () => {
    expect(MemoryRowSchema.safeParse({ ...base, tier: 'bogus' }).success).toBe(false)
  })

  it('requires string meta (JSON-stringified per spec)', () => {
    expect(MemoryRowSchema.safeParse({ ...base, meta: { event: 'x' } }).success).toBe(false)
  })
})

describe('SessionMetaSchema', () => {
  it('accepts full session meta', () => {
    const parsed = SessionMetaSchema.safeParse({
      sessionKey: 'agent:main:chat',
      sessionId: 's1',
      kind: 'chat',
      chatType: 'direct',
      model: 'claude-opus',
      modelProvider: 'anthropic',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      contextTokens: 140,
      estimatedCostUsd: 0.01,
      status: 'active',
      startedAt: 1000,
      endedAt: null,
      runtimeMs: 2000,
      abortedLastRun: false,
      systemSent: true,
      origin: {
        label: 'test',
        provider: 'api',
        surface: 'cli',
        chatType: 'direct',
        from: null,
        to: null,
        accountId: null,
      },
    })
    expect(parsed.success).toBe(true)
  })
})

describe('TurnMetaSchema', () => {
  it('accepts message event', () => {
    expect(
      TurnMetaSchema.safeParse({
        sessionId: 's1',
        sessionKey: 'agent:main',
        eventType: 'message',
        role: 'user',
        parentId: null,
        timestamp: 1000,
        usage: null,
        costUsd: null,
        provider: null,
        model: null,
        truncated: false,
        rawByteOffset: null,
      }).success
    ).toBe(true)
  })

  it('accepts tool_call event', () => {
    expect(
      TurnMetaSchema.safeParse({
        sessionId: 's1',
        sessionKey: 'agent:main',
        eventType: 'tool_call',
        role: null,
        parentId: 'p1',
        timestamp: 1000,
        tool: 'Read',
        toolCallId: 't1',
        truncated: true,
        rawByteOffset: 12345,
      }).success
    ).toBe(true)
  })

  it('rejects unsupported eventType', () => {
    expect(
      TurnMetaSchema.safeParse({
        sessionId: 's1',
        sessionKey: 'agent:main',
        eventType: 'thinking_level_change',
        role: null,
        parentId: null,
        timestamp: 1000,
      }).success
    ).toBe(false)
  })
})

describe('CheckpointMetaSchema', () => {
  it('accepts overflow trigger with token counts', () => {
    expect(
      CheckpointMetaSchema.safeParse({
        sessionId: 's1',
        checkpointId: 'cp1',
        trigger: 'overflow',
        tokensBefore: 180000,
        tokensAfter: 40000,
        summary: 'summary text',
        createdAt: 1000,
      }).success
    ).toBe(true)
  })
})

describe('DailyNoteMetaSchema', () => {
  it('accepts a note with runtimeIndexed flag', () => {
    expect(
      DailyNoteMetaSchema.safeParse({
        file: '2026-04-17.md',
        date: '2026-04-17',
        sizeBytes: 1024,
        runtimeIndexed: true,
      }).success
    ).toBe(true)
  })
})

describe('DreamMetaSchema', () => {
  it('accepts a phase doc', () => {
    expect(
      DreamMetaSchema.safeParse({
        phase: 'light',
        date: '2026-04-17',
        sourceDay: '2026-04-16',
        artifactType: 'phase_doc',
      }).success
    ).toBe(true)
  })

  it('accepts a short_term_recall artifact without phase/date', () => {
    expect(
      DreamMetaSchema.safeParse({
        phase: null,
        date: null,
        sourceDay: null,
        artifactType: 'short_term_recall',
      }).success
    ).toBe(true)
  })

  it('rejects unknown artifactType', () => {
    expect(
      DreamMetaSchema.safeParse({
        phase: 'light',
        date: '2026-04-17',
        sourceDay: null,
        artifactType: 'bogus',
      }).success
    ).toBe(false)
  })
})

describe('DurableMetaSchema', () => {
  it('accepts a heading chunk', () => {
    expect(
      DurableMetaSchema.safeParse({
        file: 'SOUL.md',
        headingLevel: 2,
        headingPath: ['Soul', 'Core'],
        chunkIndex: 0,
      }).success
    ).toBe(true)
  })

  it('accepts a chunk with no headings (level 0)', () => {
    expect(
      DurableMetaSchema.safeParse({
        file: 'USER.md',
        headingLevel: 0,
        headingPath: [],
        chunkIndex: 0,
      }).success
    ).toBe(true)
  })
})

describe('AuditMetaSchema', () => {
  it('accepts a minimal audit entry', () => {
    expect(
      AuditMetaSchema.safeParse({
        event: 'task.created',
        agent: 'main',
        channel: null,
        actor: null,
        data: { taskId: 't1' },
      }).success
    ).toBe(true)
  })
})
