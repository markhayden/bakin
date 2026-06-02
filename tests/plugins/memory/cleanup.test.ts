/**
 * Unit tests for plugins/memory/lib/cleanup.ts — the pure core of the
 * memory-cleanup feature: exact-match detection, tier labeling, snippet
 * extraction, and grouping search hits by agent.
 *
 * Pure functions only (no app/storage imports), so no content-dir mocks needed.
 */
import { describe, it, expect } from 'bun:test'

import {
  ACTIONABLE_TIERS,
  composeTask,
  contentMatches,
  groupByAgent,
  matchingSnippets,
  tierLabel,
  type CleanupHit,
} from '../../../plugins/memory/lib/cleanup'

describe('tierLabel', () => {
  it('labels durable / daily_note / dream as actionable (agent-editable sources)', () => {
    expect(tierLabel('durable')).toBe('actionable')
    expect(tierLabel('daily_note')).toBe('actionable')
    expect(tierLabel('dream')).toBe('actionable')
  })
  it('labels session / turn / checkpoint / audit as informational (left alone)', () => {
    expect(tierLabel('session')).toBe('informational')
    expect(tierLabel('turn')).toBe('informational')
    expect(tierLabel('checkpoint')).toBe('informational')
    expect(tierLabel('audit')).toBe('informational')
  })
  it('ACTIONABLE_TIERS holds exactly the three editable doc tiers', () => {
    expect([...ACTIONABLE_TIERS].sort()).toEqual(['daily_note', 'dream', 'durable'])
  })
})

describe('contentMatches', () => {
  it('matches case-insensitively', () => {
    expect(contentMatches('Use the Beacon MCP', 'beacon')).toBe(true)
    expect(contentMatches('use the BEACON mcp', 'Beacon')).toBe(true)
  })
  it('is a substring match, not semantic', () => {
    expect(contentMatches('this references bakin only', 'beacon')).toBe(false)
  })
  it('returns false for an empty term', () => {
    expect(contentMatches('anything', '')).toBe(false)
  })
})

describe('matchingSnippets', () => {
  it('returns the matching lines, trimmed, capped', () => {
    const content = 'line one\n  use the beacon tool  \nline three\nbeacon again here'
    expect(matchingSnippets(content, 'beacon', 3)).toEqual([
      'use the beacon tool',
      'beacon again here',
    ])
  })
  it('caps at maxLines', () => {
    const content = 'beacon a\nbeacon b\nbeacon c\nbeacon d'
    expect(matchingSnippets(content, 'beacon', 2)).toHaveLength(2)
  })
  it('falls back to a window for single-line / no-newline content', () => {
    const content = 'x'.repeat(100) + 'beacon' + 'y'.repeat(100)
    const snips = matchingSnippets(content, 'beacon')
    expect(snips).toHaveLength(1)
    expect(snips[0]).toContain('beacon')
    expect(snips[0].length).toBeLessThan(content.length)
  })
  it('returns [] when there is no match', () => {
    expect(matchingSnippets('nothing here', 'beacon')).toEqual([])
  })
})

describe('groupByAgent', () => {
  const hit = (agent: string, label: 'actionable' | 'informational', rowId: string): CleanupHit => ({
    rowId,
    tier: label === 'actionable' ? 'durable' : 'turn',
    agent,
    sourcePath: `/ws/${agent}/file.md`,
    label,
    snippets: ['beacon'],
  })

  it('groups hits by agent with an actionable count', () => {
    const groups = groupByAgent([
      hit('pixel', 'actionable', 'a'),
      hit('pixel', 'informational', 'b'),
      hit('penelope', 'actionable', 'c'),
    ])
    expect(groups).toHaveLength(2)
    const pixel = groups.find((g) => g.agent === 'pixel')!
    expect(pixel.hits).toHaveLength(2)
    expect(pixel.actionableCount).toBe(1)
  })

  it('sorts most-actionable first', () => {
    const groups = groupByAgent([
      hit('low', 'actionable', 'a'),
      hit('high', 'actionable', 'b'),
      hit('high', 'actionable', 'c'),
    ])
    expect(groups[0].agent).toBe('high')
    expect(groups[1].agent).toBe('low')
  })

  it('returns [] for no hits', () => {
    expect(groupByAgent([])).toEqual([])
  })
})

describe('composeTask', () => {
  const hits: CleanupHit[] = [
    { rowId: 'durable:1', tier: 'durable', agent: 'pixel', sourcePath: '/ws/pixel/AGENTS.md', label: 'actionable', snippets: ['use the beacon mcp'] },
    { rowId: 'daily_note:1', tier: 'daily_note', agent: 'pixel', sourcePath: '/ws/pixel/memory/2026-01-01.md', label: 'actionable', snippets: ['beacon notes'] },
  ]

  it('replace: title names the rename and description carries the replacement + findings', () => {
    const { title, description } = composeTask({ term: 'beacon', action: 'replace', replacement: 'bakin', agent: 'pixel', hits })
    expect(title).toContain('beacon')
    expect(title.toLowerCase()).toContain('rename')
    expect(title).toContain('bakin')
    expect(description).toContain('bakin')
    expect(description).toContain('/ws/pixel/AGENTS.md')
    expect(description).toContain('use the beacon mcp')
  })

  it('remove: title/description say remove and no replacement is referenced', () => {
    const { title, description } = composeTask({ term: 'beacon', action: 'remove', agent: 'pixel', hits })
    expect(title.toLowerCase()).toContain('remove')
    expect(description.toLowerCase()).toContain('remove')
  })

  it('a custom instruction overrides the default lead', () => {
    const { description } = composeTask({ term: 'beacon', action: 'remove', agent: 'pixel', hits, instruction: 'PURGE ALL TRACE' })
    expect(description).toContain('PURGE ALL TRACE')
  })

  it('lists every actionable hit source path', () => {
    const { description } = composeTask({ term: 'beacon', action: 'remove', agent: 'pixel', hits })
    expect(description).toContain('/ws/pixel/AGENTS.md')
    expect(description).toContain('/ws/pixel/memory/2026-01-01.md')
  })
})
