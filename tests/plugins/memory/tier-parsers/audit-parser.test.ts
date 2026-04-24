/**
 * Tests for plugins/memory/lib/tier-parsers/audit-parser.ts.
 *
 * The audit parser is the simplest of all tier parsers — one JSONL line in,
 * one MemoryRow (or null) out. No I/O, no state; just translation from
 * Bakin audit entry shape to `bakin_memory` row shape.
 */
import { describe, it, expect, mock } from 'bun:test'

// Defensive isolation: parser is pure, but any transitive import that
// reaches content-dir must be redirected away from ~/.bakin/.
mock.module('../../../../src/core/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-audit-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
mock.module('../../../../packages/core/src/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-audit-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
mock.module('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { parseAuditLine } from '../../../../plugins/memory/lib/tier-parsers/audit-parser'
import { MemoryRowSchema, AuditMetaSchema } from '../../../../plugins/memory/lib/types'

const auditPath = '/fake/.bakin/audit.jsonl'

describe('parseAuditLine — valid input', () => {
  it('returns a MemoryRow with tier=audit for a well-formed line', () => {
    const line = JSON.stringify({
      ts: '2026-04-18T12:00:00.000Z',
      event: 'task.created',
      agent: 'patch',
      data: { taskId: 'abc123' },
    })

    const row = parseAuditLine(line, auditPath, 0)
    expect(row).not.toBeNull()
    expect(row!.tier).toBe('audit')
    expect(row!.agent).toBe('patch')
    expect(row!.title).toBe('task.created')
    expect(MemoryRowSchema.safeParse(row).success).toBe(true)
  })

  it('derives updatedAt/createdAt from the ISO ts field', () => {
    const ts = '2026-04-18T12:00:00.000Z'
    const row = parseAuditLine(
      JSON.stringify({ ts, event: 'e', agent: 'patch' }),
      auditPath,
      0,
    )
    expect(row!.updatedAt).toBe(Date.parse(ts))
    expect(row!.createdAt).toBe(Date.parse(ts))
  })

  it('preserves channel and full data inside meta (AuditMeta shape)', () => {
    const line = JSON.stringify({
      ts: '2026-04-18T12:00:00.000Z',
      event: 'mcp.call',
      agent: 'scout',
      channel: 'mcp',
      data: { tool: 'search', args: { q: 'x' } },
    })

    const row = parseAuditLine(line, auditPath, 0)!
    const meta = AuditMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.event).toBe('mcp.call')
    expect(meta.channel).toBe('mcp')
    expect(meta.agent).toBe('scout')
    expect(meta.data).toEqual({ tool: 'search', args: { q: 'x' } })
  })

  it('sets channel=null when the field is missing', () => {
    const line = JSON.stringify({
      ts: '2026-04-18T12:00:00.000Z',
      event: 'x',
      agent: 'patch',
    })
    const row = parseAuditLine(line, auditPath, 0)!
    const meta = AuditMetaSchema.parse(JSON.parse(row.meta))
    expect(meta.channel).toBeNull()
  })

  it('produces a stable id for identical content', () => {
    const line = JSON.stringify({
      ts: '2026-04-18T12:00:00.000Z',
      event: 'task.created',
      agent: 'patch',
    })
    const a = parseAuditLine(line, auditPath, 0)!
    const b = parseAuditLine(line, auditPath, 0)!
    expect(a.id).toBe(b.id)
    expect(a.id).toMatch(/^audit:/)
  })

  it('produces different ids for different ts/event/agent combos', () => {
    const a = parseAuditLine(
      JSON.stringify({ ts: '2026-04-18T12:00:00.000Z', event: 'e1', agent: 'patch' }),
      auditPath,
      0,
    )!
    const b = parseAuditLine(
      JSON.stringify({ ts: '2026-04-18T12:00:01.000Z', event: 'e1', agent: 'patch' }),
      auditPath,
      0,
    )!
    expect(a.id).not.toBe(b.id)
  })

  it('includes sourceRef pointing back at the audit file with offset', () => {
    const row = parseAuditLine(
      JSON.stringify({ ts: '2026-04-18T12:00:00.000Z', event: 'e', agent: 'a' }),
      auditPath,
      1234,
    )!
    expect(row.sourceRef.backend).toBe('bakin')
    expect(row.sourceRef.path).toBe(auditPath)
    expect(row.sourceRef.file).toBe('audit.jsonl')
    expect(row.sourceRef.offset).toBe(1234)
  })

  it('falls back agent="system" when agent is empty string', () => {
    const row = parseAuditLine(
      JSON.stringify({ ts: '2026-04-18T12:00:00.000Z', event: 'boot', agent: '' }),
      auditPath,
      0,
    )!
    expect(row.agent).toBe('system')
  })

  it('content stringifies event + data for full-text search', () => {
    const row = parseAuditLine(
      JSON.stringify({
        ts: '2026-04-18T12:00:00.000Z',
        event: 'task.created',
        agent: 'patch',
        data: { taskId: 'abc', title: 'Ship it' },
      }),
      auditPath,
      0,
    )!
    expect(row.content).toContain('task.created')
    expect(row.content).toContain('Ship it')
    expect(row.content).toContain('abc')
  })

  it('truncates snippet at ~2KB but keeps full content', () => {
    const bigTitle = 'x'.repeat(5000)
    const row = parseAuditLine(
      JSON.stringify({
        ts: '2026-04-18T12:00:00.000Z',
        event: 'big',
        agent: 'patch',
        data: { blob: bigTitle },
      }),
      auditPath,
      0,
    )!
    expect(row.snippet.length).toBeLessThanOrEqual(2048)
    expect(row.content.length).toBeGreaterThan(2048)
  })
})

describe('parseAuditLine — invalid input', () => {
  it('returns null for an empty line', () => {
    expect(parseAuditLine('', auditPath, 0)).toBeNull()
    expect(parseAuditLine('   ', auditPath, 0)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseAuditLine('{not json', auditPath, 0)).toBeNull()
  })

  it('returns null when ts is missing', () => {
    expect(
      parseAuditLine(JSON.stringify({ event: 'e', agent: 'a' }), auditPath, 0),
    ).toBeNull()
  })

  it('returns null when event is missing', () => {
    expect(
      parseAuditLine(
        JSON.stringify({ ts: '2026-04-18T12:00:00.000Z', agent: 'a' }),
        auditPath,
        0,
      ),
    ).toBeNull()
  })

  it('returns null when ts is not a parseable date', () => {
    expect(
      parseAuditLine(
        JSON.stringify({ ts: 'not-a-date', event: 'e', agent: 'a' }),
        auditPath,
        0,
      ),
    ).toBeNull()
  })
})
