/**
 * Tests for plugins/memory/lib/tier-parsers/skill-parser.ts.
 *
 * Skill parser: SKILL.md content → one MemoryRow per H1/H2 chunk, tagged as
 * tier=durable, kind=skill. Pure — no I/O. Reuses the durable parser's
 * H1/H2 chunker so identity of row layout stays aligned across durable-family
 * files.
 */
import { describe, it, expect, mock } from 'bun:test'

// Defensive isolation (hook requires these even for pure modules).
mock.module('../../../../src/core/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-skill-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
mock.module('../../../../packages/core/src/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-skill-parser-mock')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base }) }
})
mock.module('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { parseSkillFile } from '../../../../plugins/memory/lib/tier-parsers/skill-parser'
import { MemoryRowSchema } from '../../../../plugins/memory/lib/types'

const sourcePath = '/fake/.openclaw/workspace/skills/research/SKILL.md'
const updatedAt = Date.parse('2026-04-18T12:00:00.000Z')

describe('parseSkillFile — tier + kind', () => {
  it('emits rows with tier=durable and kind=skill', () => {
    const rows = parseSkillFile('main', 'research', '# Intro\nbody', sourcePath, updatedAt)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.tier).toBe('durable')
      expect(r.kind).toBe('skill')
      expect(MemoryRowSchema.safeParse(r).success).toBe(true)
    }
  })
})

describe('parseSkillFile — title composition', () => {
  it('uses just the skill name when there are no headings', () => {
    const rows = parseSkillFile('main', 'research', 'plain body, no headings', sourcePath, updatedAt)
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('research')
  })

  it('prefixes the skill name for headed chunks: "<skill> — <heading>"', () => {
    const src = [
      '# Overview',
      'overview body',
      '',
      '## Usage',
      'usage body',
    ].join('\n')
    const rows = parseSkillFile('main', 'research', src, sourcePath, updatedAt)
    expect(rows.map((r) => r.title)).toEqual([
      'research — Overview',
      'research — Usage',
    ])
  })
})

describe('parseSkillFile — row identity', () => {
  it('produces a stable id for the same (agent, skillName, chunkIndex)', () => {
    const src = '# A\nbody\n# B\nbody2'
    const a = parseSkillFile('main', 'research', src, sourcePath, updatedAt)
    const b = parseSkillFile('main', 'research', src, sourcePath, updatedAt)
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
    for (const r of a) expect(r.id).toMatch(/^skill:/)
  })

  it('different skills under the same agent produce different ids', () => {
    const src = '# A\nbody'
    const a = parseSkillFile('main', 'research', src, sourcePath, updatedAt)[0]
    const b = parseSkillFile('main', 'summarize', src, sourcePath, updatedAt)[0]
    expect(a.id).not.toBe(b.id)
  })

  it('different agents with the same skill produce different ids', () => {
    const src = '# A\nbody'
    const a = parseSkillFile('main', 'research', src, sourcePath, updatedAt)[0]
    const b = parseSkillFile('scout', 'research', src, sourcePath, updatedAt)[0]
    expect(a.id).not.toBe(b.id)
  })

  it('skill rows do not collide with durable rows (distinct id prefix)', () => {
    const rows = parseSkillFile('main', 'research', '# A\nbody', sourcePath, updatedAt)
    // Durable rows use prefix `durable:`; skill rows use prefix `skill:`.
    expect(rows[0].id.startsWith('durable:')).toBe(false)
    expect(rows[0].id.startsWith('skill:')).toBe(true)
  })
})

describe('parseSkillFile — meta', () => {
  it('records skillName and chunkIndex in meta', () => {
    const src = '# A\nbody-a\n# B\nbody-b'
    const rows = parseSkillFile('main', 'research', src, sourcePath, updatedAt)
    const metas = rows.map((r) => JSON.parse(r.meta))
    expect(metas[0].skillName).toBe('research')
    expect(metas[0].chunkIndex).toBe(0)
    expect(metas[1].chunkIndex).toBe(1)
  })
})

describe('parseSkillFile — sourceRef + timestamps', () => {
  it('sourceRef.backend=openclaw with the full SKILL.md path', () => {
    const rows = parseSkillFile('main', 'research', '# A\nbody', sourcePath, updatedAt)
    expect(rows[0].sourceRef.backend).toBe('openclaw')
    expect(rows[0].sourceRef.path).toBe(sourcePath)
    expect(rows[0].sourceRef.file).toBe('SKILL.md')
  })

  it('updatedAt and createdAt derive from mtime arg', () => {
    const rows = parseSkillFile('main', 'research', '# A\nbody', sourcePath, updatedAt)
    expect(rows[0].updatedAt).toBe(updatedAt)
    expect(rows[0].createdAt).toBe(updatedAt)
  })
})

describe('parseSkillFile — snippet cap', () => {
  it('snippet caps at ~2KB but content keeps the full chunk', () => {
    const big = 'x'.repeat(5000)
    const rows = parseSkillFile('main', 'research', `# Intro\n${big}`, sourcePath, updatedAt)
    expect(rows[0].snippet.length).toBeLessThanOrEqual(2048)
    expect(rows[0].content.length).toBeGreaterThan(2048)
  })
})
