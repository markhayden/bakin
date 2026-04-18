/**
 * Tests for plugins/memory/lib/tier-parsers/durable-parser.ts.
 *
 * Durable parser: canonical bootstrap file content → one MemoryRow per H1/H2
 * chunk. Pure — no I/O, no filesystem. Given an agent id, a basename like
 * `SOUL.md`, and the file contents, emits an ordered array of rows suitable
 * for `bakin_memory`.
 */
import { describe, it, expect, vi } from 'vitest'

// Defensive isolation (hook requires these even for pure modules).
vi.mock('../../../../src/core/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-durable-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
vi.mock('../../../../packages/core/src/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-durable-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
vi.mock('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { parseDurableFile } from '../../../../plugins/memory/lib/tier-parsers/durable-parser'
import { MemoryRowSchema, DurableMetaSchema } from '../../../../plugins/memory/lib/types'

const workspacePath = '/fake/.openclaw/workspace/SOUL.md'
const updatedAt = Date.parse('2026-04-18T12:00:00.000Z')

describe('parseDurableFile — no headings', () => {
  it('returns a single row with chunkIndex=0, headingLevel=0, empty headingPath', () => {
    const rows = parseDurableFile('main', 'SOUL.md', 'plain body, no headings', workspacePath, updatedAt)
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.tier).toBe('durable')
    expect(r.agent).toBe('main')
    expect(r.content).toContain('plain body')
    expect(MemoryRowSchema.safeParse(r).success).toBe(true)

    const meta = DurableMetaSchema.parse(JSON.parse(r.meta))
    expect(meta.file).toBe('SOUL.md')
    expect(meta.headingLevel).toBe(0)
    expect(meta.headingPath).toEqual([])
    expect(meta.chunkIndex).toBe(0)
  })

  it('uses the basename as the row title when there are no headings', () => {
    const rows = parseDurableFile('main', 'SOUL.md', 'just body', workspacePath, updatedAt)
    expect(rows[0].title).toBe('SOUL.md')
  })

  it('returns a single row with empty content when file is empty', () => {
    const rows = parseDurableFile('main', 'SOUL.md', '', workspacePath, updatedAt)
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('')
  })
})

describe('parseDurableFile — flat H1 chunking', () => {
  const src = [
    '# Intro',
    'intro body text',
    '',
    '# Rules',
    'rule body text',
    '',
    '# Boundaries',
    'boundary body text',
  ].join('\n')

  it('produces one row per H1', () => {
    const rows = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.title)).toEqual(['Intro', 'Rules', 'Boundaries'])
  })

  it('tags each row with headingLevel=1 and the heading in headingPath', () => {
    const rows = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    const metas = rows.map((r) => DurableMetaSchema.parse(JSON.parse(r.meta)))
    expect(metas[0].headingLevel).toBe(1)
    expect(metas[0].headingPath).toEqual(['Intro'])
    expect(metas[1].headingPath).toEqual(['Rules'])
    expect(metas[2].headingPath).toEqual(['Boundaries'])
  })

  it('assigns chunkIndex in document order', () => {
    const rows = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    const indices = rows.map((r) => DurableMetaSchema.parse(JSON.parse(r.meta)).chunkIndex)
    expect(indices).toEqual([0, 1, 2])
  })

  it('chunk content includes the heading and its body only', () => {
    const rows = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    expect(rows[0].content).toContain('Intro')
    expect(rows[0].content).toContain('intro body text')
    expect(rows[0].content).not.toContain('rule body text')
  })
})

describe('parseDurableFile — H1/H2 nesting', () => {
  const src = [
    '# Rules',
    'top-level body',
    '',
    '## Style',
    'style body',
    '',
    '## Safety',
    'safety body',
    '',
    '# Boundaries',
    'boundary body',
  ].join('\n')

  it('emits rows at both H1 and H2 boundaries', () => {
    const rows = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    expect(rows.map((r) => r.title)).toEqual(['Rules', 'Style', 'Safety', 'Boundaries'])
  })

  it('records parent H1 in headingPath for H2 chunks', () => {
    const rows = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    const metas = rows.map((r) => DurableMetaSchema.parse(JSON.parse(r.meta)))
    expect(metas[0].headingPath).toEqual(['Rules'])
    expect(metas[0].headingLevel).toBe(1)
    expect(metas[1].headingPath).toEqual(['Rules', 'Style'])
    expect(metas[1].headingLevel).toBe(2)
    expect(metas[2].headingPath).toEqual(['Rules', 'Safety'])
    expect(metas[3].headingPath).toEqual(['Boundaries'])
    expect(metas[3].headingLevel).toBe(1)
  })

  it('H1 chunk includes its intro body but not nested H2 bodies', () => {
    const rows = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    expect(rows[0].content).toContain('top-level body')
    expect(rows[0].content).not.toContain('style body')
    expect(rows[0].content).not.toContain('safety body')
  })
})

describe('parseDurableFile — deeper headings (H3+) stay inside the enclosing H2', () => {
  const src = [
    '# Rules',
    '',
    '## Style',
    '',
    '### Naming',
    'naming body',
    '',
    '### Spacing',
    'spacing body',
    '',
    '## Safety',
    'safety body',
  ].join('\n')

  it('produces rows only at H1/H2 boundaries, absorbing H3 as body', () => {
    const rows = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    expect(rows.map((r) => r.title)).toEqual(['Rules', 'Style', 'Safety'])
  })

  it('H3 headings land inside the owning H2 chunk content', () => {
    const rows = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    expect(rows[1].title).toBe('Style')
    expect(rows[1].content).toContain('Naming')
    expect(rows[1].content).toContain('naming body')
    expect(rows[1].content).toContain('Spacing')
    expect(rows[1].content).toContain('spacing body')
  })
})

describe('parseDurableFile — row identity + shape', () => {
  it('produces a stable id for the same (agent, file, chunkIndex)', () => {
    const src = '# A\nbody\n# B\nbody2\n'
    const a = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    const b = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
    for (const r of a) expect(r.id).toMatch(/^durable:/)
  })

  it('different agents produce different ids for the same chunk', () => {
    const src = '# Intro\nbody'
    const a = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)[0]
    const b = parseDurableFile('explorer', 'SOUL.md', src, workspacePath, updatedAt)[0]
    expect(a.id).not.toBe(b.id)
  })

  it('different files produce different ids for the same chunk', () => {
    const src = '# Intro\nbody'
    const a = parseDurableFile('main', 'SOUL.md', src, workspacePath, updatedAt)[0]
    const b = parseDurableFile('main', 'MEMORY.md', src, workspacePath, updatedAt)[0]
    expect(a.id).not.toBe(b.id)
  })

  it('sourceRef includes backend=openclaw and the full workspace path', () => {
    const rows = parseDurableFile('main', 'SOUL.md', '# A\nbody', workspacePath, updatedAt)
    expect(rows[0].sourceRef.backend).toBe('openclaw')
    expect(rows[0].sourceRef.path).toBe(workspacePath)
    expect(rows[0].sourceRef.file).toBe('SOUL.md')
  })

  it('updatedAt and createdAt derive from the file mtime arg', () => {
    const rows = parseDurableFile('main', 'SOUL.md', '# A\nbody', workspacePath, updatedAt)
    expect(rows[0].updatedAt).toBe(updatedAt)
    expect(rows[0].createdAt).toBe(updatedAt)
  })

  it('snippet caps at ~2KB but content keeps the full chunk', () => {
    const big = 'x'.repeat(5000)
    const rows = parseDurableFile('main', 'SOUL.md', `# Intro\n${big}`, workspacePath, updatedAt)
    expect(rows[0].snippet.length).toBeLessThanOrEqual(2048)
    expect(rows[0].content.length).toBeGreaterThan(2048)
  })
})
