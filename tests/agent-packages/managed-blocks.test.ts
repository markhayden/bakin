/**
 * Tests for managed-block primitives (A-4).
 *
 * Coverage:
 *   - hasBlock / extractBlock happy + missing + malformed paths
 *   - listBlocks discovers all pairs in order
 *   - injectBlock inserts when absent, updates in place when present
 *   - injectBlock preserves surrounding content exactly
 *   - injectBlock recovers from start-without-end (rewrite from marker to EOF)
 *   - removeBlock strips markers + body and normalizes whitespace
 *   - removeBlock no-ops on missing block
 *   - Block id validation
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-managed-blocks-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  extractBlock,
  hasBlock,
  injectBlock,
  isValidBlockId,
  listBlocks,
  removeBlock,
} from '../../packages/core/src/agent-packages/managed-blocks'

describe('isValidBlockId', () => {
  it('accepts knowledge-style nested ids', () => {
    expect(isValidBlockId('knowledge:pixel:product-photography')).toBe(true)
  })

  it('accepts simple ids', () => {
    expect(isValidBlockId('mission-control')).toBe(true)
  })

  it('rejects empty ids', () => {
    expect(isValidBlockId('')).toBe(false)
  })

  it('rejects ids with spaces', () => {
    expect(isValidBlockId('has space')).toBe(false)
  })

  it('rejects ids starting with colon', () => {
    expect(isValidBlockId(':leading-colon')).toBe(false)
  })
})

describe('hasBlock / extractBlock', () => {
  const content = `# Pixel SOUL

Some agent prose.

<!-- bakin:knowledge-catalog:start -->
- product-photography
- editorial
<!-- bakin:knowledge-catalog:end -->

More prose.

<!-- bakin:knowledge:pixel:product-photography:start -->
Product photography lessons.
<!-- bakin:knowledge:pixel:product-photography:end -->
`

  it('hasBlock returns true for existing block', () => {
    expect(hasBlock(content, 'knowledge-catalog')).toBe(true)
  })

  it('hasBlock returns false for missing block', () => {
    expect(hasBlock(content, 'mission-control')).toBe(false)
  })

  it('extractBlock returns trimmed body', () => {
    expect(extractBlock(content, 'knowledge-catalog')).toBe('- product-photography\n- editorial')
  })

  it('extractBlock handles colon-separated nested ids', () => {
    expect(extractBlock(content, 'knowledge:pixel:product-photography')).toBe(
      'Product photography lessons.',
    )
  })

  it('extractBlock returns null for missing block', () => {
    expect(extractBlock(content, 'ghost')).toBeNull()
  })

  it('extractBlock returns null on start-without-end', () => {
    const broken = `<!-- bakin:foo:start -->\nbody\nno end marker`
    expect(extractBlock(broken, 'foo')).toBeNull()
  })

  it('extractBlock returns null on invalid block id', () => {
    expect(extractBlock(content, 'has space')).toBeNull()
  })
})

describe('listBlocks', () => {
  it('returns blocks in source order', () => {
    const content = `<!-- bakin:first:start -->
A
<!-- bakin:first:end -->

<!-- bakin:second:start -->
B
<!-- bakin:second:end -->`
    const blocks = listBlocks(content)
    expect(blocks.map((b) => b.blockId)).toEqual(['first', 'second'])
    expect(blocks[0].body).toBe('A')
    expect(blocks[1].body).toBe('B')
  })

  it('skips orphan start markers', () => {
    const content = `<!-- bakin:dangling:start -->
no end here

<!-- bakin:closed:start -->
ok
<!-- bakin:closed:end -->`
    const blocks = listBlocks(content)
    expect(blocks.map((b) => b.blockId)).toEqual(['closed'])
  })

  it('skips orphan end markers', () => {
    const content = `<!-- bakin:dangling:end -->

<!-- bakin:closed:start -->
ok
<!-- bakin:closed:end -->`
    const blocks = listBlocks(content)
    expect(blocks.map((b) => b.blockId)).toEqual(['closed'])
  })

  it('returns empty array on content with no markers', () => {
    expect(listBlocks('# Just markdown\n\nNo blocks.')).toEqual([])
  })
})

describe('injectBlock', () => {
  it('appends to empty content', () => {
    const out = injectBlock('', 'foo', 'body')
    expect(out).toBe(`<!-- bakin:foo:start -->\nbody\n<!-- bakin:foo:end -->\n`)
  })

  it('appends to non-empty content with one blank line of separation', () => {
    const before = '# Header\n\nProse.'
    const out = injectBlock(before, 'foo', 'body')
    expect(out).toBe(
      `# Header\n\nProse.\n\n<!-- bakin:foo:start -->\nbody\n<!-- bakin:foo:end -->\n`,
    )
  })

  it('updates in place when block already exists', () => {
    const before = `pre\n<!-- bakin:foo:start -->\nold body\n<!-- bakin:foo:end -->\npost`
    const out = injectBlock(before, 'foo', 'new body')
    expect(out).toBe(`pre\n<!-- bakin:foo:start -->\nnew body\n<!-- bakin:foo:end -->\npost`)
  })

  it('preserves content outside markers exactly', () => {
    const before = `line1\nline2\n<!-- bakin:foo:start -->\nold\n<!-- bakin:foo:end -->\nline3\nline4`
    const out = injectBlock(before, 'foo', 'new')
    expect(out).toBe(
      `line1\nline2\n<!-- bakin:foo:start -->\nnew\n<!-- bakin:foo:end -->\nline3\nline4`,
    )
  })

  it('trims body content', () => {
    const out = injectBlock('', 'foo', '\n\n  body  \n\n')
    expect(extractBlock(out, 'foo')).toBe('body')
  })

  it('recovers from start-without-end (replaces start-to-EOF)', () => {
    const before = `pre\n<!-- bakin:foo:start -->\nold body without end marker`
    const out = injectBlock(before, 'foo', 'new body')
    expect(out).toBe(`pre\n<!-- bakin:foo:start -->\nnew body\n<!-- bakin:foo:end -->\n`)
  })

  it('throws on invalid block id', () => {
    expect(() => injectBlock('', 'has space', 'body')).toThrow()
  })

  it('round-trips with extractBlock', () => {
    const out = injectBlock('', 'knowledge:pixel:product-photography', 'lesson body')
    expect(extractBlock(out, 'knowledge:pixel:product-photography')).toBe('lesson body')
  })
})

describe('removeBlock', () => {
  it('removes the block + markers', () => {
    const before = `pre\n\n<!-- bakin:foo:start -->\nbody\n<!-- bakin:foo:end -->\n\npost`
    const out = removeBlock(before, 'foo')
    expect(out).toBe(`pre\n\npost`)
    expect(hasBlock(out, 'foo')).toBe(false)
  })

  it('no-ops when block is absent', () => {
    const before = `pre\n\npost`
    expect(removeBlock(before, 'ghost')).toBe(before)
  })

  it('handles a block at the very start of the file', () => {
    const before = `<!-- bakin:foo:start -->\nbody\n<!-- bakin:foo:end -->\n\nrest`
    expect(removeBlock(before, 'foo')).toBe('rest')
  })

  it('handles a block at the very end of the file', () => {
    const before = `rest\n\n<!-- bakin:foo:start -->\nbody\n<!-- bakin:foo:end -->`
    expect(removeBlock(before, 'foo')).toBe('rest\n')
  })

  it('returns empty string when removing the only block', () => {
    const before = `<!-- bakin:foo:start -->\nbody\n<!-- bakin:foo:end -->`
    expect(removeBlock(before, 'foo')).toBe('')
  })

  it('removes start-without-end remnants from broken files', () => {
    const before = `pre\n\n<!-- bakin:foo:start -->\nstuck body`
    const out = removeBlock(before, 'foo')
    expect(out).toBe(`pre\n`)
  })
})
