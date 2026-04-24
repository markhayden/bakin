/**
 * Tests for plugins/memory/lib/tier-parsers/turn-parser.ts.
 *
 * One OpenClaw session JSONL line → at most one MemoryRow with tier='turn'.
 *
 * Event classification rules (see .claude/specs/memory-plugin-rebuild.md §turn):
 *   - session (header)                             → skip (null)
 *   - model_change                                  → skip
 *   - thinking_level_change                         → skip
 *   - custom (any customType, incl. model-snapshot) → skip
 *   - custom_message                                → skip
 *   - message role=user                             → eventType='message'
 *   - message role=assistant, no toolCall blocks    → eventType='message'
 *   - message role=assistant, ≥1 toolCall block     → eventType='tool_call'
 *   - message role=toolResult                       → eventType='tool_result'
 *
 * Content extraction:
 *   - message: join text blocks with "\n\n"; thinking blocks excluded.
 *   - tool_call: JSON-stringify each toolCall block (`{name, arguments}`).
 *   - tool_result: join text blocks; isError surfaces via meta.
 *
 * 32KB truncation → content sliced, meta.truncated=true, meta.rawByteOffset set.
 * Stable id: turn:<16-char-sha256(agent|sessionId|eventId)>.
 */
import { describe, it, expect, mock } from 'bun:test'

mock.module('../../../../src/core/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-turn-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
mock.module('../../../../packages/core/src/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-turn-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
mock.module('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { parseTurnLine } from '../../../../plugins/memory/lib/tier-parsers/turn-parser'
import { MemoryRowSchema, TurnMetaSchema } from '../../../../plugins/memory/lib/types'

const AGENT = 'basil'
const SESSION_ID = '8e1f8ee8-9851-4901-aa42-7b706246baab'
const SESSION_KEY = 'agent:basil:main'

function line(obj: unknown): string {
  return JSON.stringify(obj)
}

describe('parseTurnLine — skipped event types', () => {
  it('returns null for the session header line', () => {
    const out = parseTurnLine(
      AGENT,
      SESSION_ID,
      SESSION_KEY,
      line({ type: 'session', version: 3, id: SESSION_ID, timestamp: '2026-04-12T04:56:30.074Z' }),
      0,
    )
    expect(out).toBeNull()
  })

  it('returns null for model_change', () => {
    expect(
      parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
        type: 'model_change', id: 'a', parentId: null, timestamp: '2026-04-12T04:56:30.075Z',
        provider: 'anthropic', modelId: 'claude-opus-4-6',
      }), 0),
    ).toBeNull()
  })

  it('returns null for thinking_level_change', () => {
    expect(
      parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
        type: 'thinking_level_change', id: 'b', parentId: 'a', timestamp: '2026-04-12T04:56:30.075Z',
        thinkingLevel: 'low',
      }), 0),
    ).toBeNull()
  })

  it('returns null for custom events of any customType (including model-snapshot)', () => {
    for (const ct of ['model-snapshot', 'openclaw.cache-ttl', 'openclaw:prompt-error']) {
      const out = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
        type: 'custom', customType: ct, id: 'c', parentId: null,
        timestamp: '2026-04-12T04:56:30.078Z', data: { foo: 'bar' },
      }), 0)
      expect(out).toBeNull()
    }
  })

  it('returns null for custom_message and other unknown types', () => {
    expect(
      parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
        type: 'custom_message', id: 'd', parentId: null, timestamp: '2026-04-12T04:56:30.078Z',
      }), 0),
    ).toBeNull()
    expect(
      parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
        type: 'definitely-not-known', id: 'e', parentId: null, timestamp: '2026-04-12T04:56:30.078Z',
      }), 0),
    ).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, '{not json', 0)).toBeNull()
    expect(parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, '', 0)).toBeNull()
  })
})

describe('parseTurnLine — user message', () => {
  it('produces a message row with joined text content', () => {
    const row = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'u1', parentId: null,
      timestamp: '2026-04-12T04:56:30.082Z',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello, world.' },
          { type: 'text', text: 'Second block.' },
        ],
      },
    }), 100)
    expect(row).not.toBeNull()
    if (!row) return

    const validated = MemoryRowSchema.parse(row)
    expect(validated.tier).toBe('turn')
    expect(validated.agent).toBe(AGENT)
    expect(validated.content).toBe('Hello, world.\n\nSecond block.')
    const meta = TurnMetaSchema.parse(JSON.parse(validated.meta))
    expect(meta.eventType).toBe('message')
    expect(meta.role).toBe('user')
    expect(meta.sessionId).toBe(SESSION_ID)
    expect(meta.sessionKey).toBe(SESSION_KEY)
    expect(meta.truncated).toBe(false)
    expect(meta.rawByteOffset).toBe(100)
  })
})

describe('parseTurnLine — assistant message (text only)', () => {
  it('produces a message row when the assistant content has no toolCall blocks', () => {
    const row = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'a1', parentId: 'u1',
      timestamp: '2026-04-12T04:56:37.200Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'internal reasoning', thinkingSignature: 'sig...' },
          { type: 'text', text: 'Visible response.' },
        ],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        usage: {
          input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10,
          cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
        },
      },
    }), 0)
    expect(row).not.toBeNull()
    if (!row) return

    expect(row.content).toBe('Visible response.')
    expect(row.content.includes('internal reasoning')).toBe(false)
    const meta = TurnMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.eventType).toBe('message')
    expect(meta.role).toBe('assistant')
    expect(meta.provider).toBe('anthropic')
    expect(meta.model).toBe('claude-opus-4-6')
    expect(meta.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheRead: 3,
      cacheWrite: 4,
    })
    expect(meta.costUsd).toBe(0.003)
  })
})

describe('parseTurnLine — assistant tool_call', () => {
  it('classifies an assistant message containing toolCall blocks as eventType=tool_call', () => {
    const row = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'a2', parentId: 'u1',
      timestamp: '2026-04-12T04:56:37.200Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'reasoning' },
          {
            type: 'toolCall',
            id: 'toolu_01BSES',
            name: 'exec',
            arguments: { command: 'ls', timeout: 15 },
          },
          {
            type: 'toolCall',
            id: 'toolu_02KON',
            name: 'exec',
            arguments: { command: 'pwd', timeout: 15 },
          },
        ],
        provider: 'anthropic',
        model: 'claude-opus-4-6',
      },
    }), 0)
    expect(row).not.toBeNull()
    if (!row) return

    const meta = TurnMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.eventType).toBe('tool_call')
    expect(meta.tool).toBe('exec')
    expect(meta.toolCallId).toBe('toolu_01BSES')
    // content should surface both tool calls in searchable form.
    expect(row.content).toContain('exec')
    expect(row.content).toContain('ls')
    expect(row.content).toContain('pwd')
  })
})

describe('parseTurnLine — toolResult', () => {
  it('classifies role=toolResult as eventType=tool_result and surfaces toolName/toolCallId', () => {
    const row = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'r1', parentId: 'a2',
      timestamp: '2026-04-12T04:56:37.732Z',
      message: {
        role: 'toolResult',
        toolCallId: 'toolu_01BSES',
        toolName: 'exec',
        content: [{ type: 'text', text: 'stdout: ok\n' }],
        isError: false,
      },
    }), 0)
    expect(row).not.toBeNull()
    if (!row) return

    expect(row.content).toBe('stdout: ok\n')
    const meta = TurnMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.eventType).toBe('tool_result')
    expect(meta.tool).toBe('exec')
    expect(meta.toolCallId).toBe('toolu_01BSES')
  })
})

describe('parseTurnLine — truncation', () => {
  it('truncates content > 32KB and marks meta.truncated=true with rawByteOffset', () => {
    const big = 'x'.repeat(50_000)
    const offset = 12_345
    const row = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'big', parentId: null,
      timestamp: '2026-04-12T04:56:30.082Z',
      message: { role: 'user', content: [{ type: 'text', text: big }] },
    }), offset)
    expect(row).not.toBeNull()
    if (!row) return

    expect(row.content.length).toBeLessThanOrEqual(32_768)
    const meta = TurnMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.truncated).toBe(true)
    expect(meta.rawByteOffset).toBe(offset)
  })

  it('leaves meta.truncated=false when content is under the cap', () => {
    const row = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'small', parentId: null,
      timestamp: '2026-04-12T04:56:30.082Z',
      message: { role: 'user', content: [{ type: 'text', text: 'short' }] },
    }), 0)
    if (!row) throw new Error('expected row')
    const meta = TurnMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.truncated).toBe(false)
  })
})

describe('parseTurnLine — stable id', () => {
  it('produces the same id for the same (agent, sessionId, eventId) regardless of content', () => {
    const a = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'fixed', parentId: null,
      timestamp: '2026-04-12T04:56:30.082Z',
      message: { role: 'user', content: [{ type: 'text', text: 'first' }] },
    }), 0)
    const b = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'fixed', parentId: null,
      timestamp: '2026-04-12T04:56:30.082Z',
      message: { role: 'user', content: [{ type: 'text', text: 'rewritten' }] },
    }), 99)
    if (!a || !b) throw new Error('expected rows')
    expect(a.id).toBe(b.id)
    expect(a.id).toMatch(/^turn:[0-9a-f]{16}$/)
  })

  it('produces different ids for different eventIds within the same session', () => {
    const a = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'one', parentId: null,
      timestamp: '2026-04-12T04:56:30.082Z',
      message: { role: 'user', content: [{ type: 'text', text: 'x' }] },
    }), 0)
    const b = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'two', parentId: null,
      timestamp: '2026-04-12T04:56:30.082Z',
      message: { role: 'user', content: [{ type: 'text', text: 'x' }] },
    }), 0)
    if (!a || !b) throw new Error('expected rows')
    expect(a.id).not.toBe(b.id)
  })

  it('produces different ids across different sessions', () => {
    const a = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'same', parentId: null,
      timestamp: '2026-04-12T04:56:30.082Z',
      message: { role: 'user', content: [{ type: 'text', text: 'x' }] },
    }), 0)
    const b = parseTurnLine(AGENT, 'other-session-id', 'agent:basil:openai:other', line({
      type: 'message', id: 'same', parentId: null,
      timestamp: '2026-04-12T04:56:30.082Z',
      message: { role: 'user', content: [{ type: 'text', text: 'x' }] },
    }), 0)
    if (!a || !b) throw new Error('expected rows')
    expect(a.id).not.toBe(b.id)
  })
})

describe('parseTurnLine — timestamp handling', () => {
  it('converts ISO-string timestamp to epoch ms on the row and in meta', () => {
    const ts = '2026-04-12T04:56:30.082Z'
    const expected = Date.parse(ts)
    const row = parseTurnLine(AGENT, SESSION_ID, SESSION_KEY, line({
      type: 'message', id: 'ts', parentId: null, timestamp: ts,
      message: { role: 'user', content: [{ type: 'text', text: 'x' }] },
    }), 0)
    if (!row) throw new Error('expected row')
    expect(row.updatedAt).toBe(expected)
    expect(row.createdAt).toBe(expected)
    const meta = TurnMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.timestamp).toBe(expected)
  })
})
