/**
 * parseFrontmatter / splitFrontmatter (packages/core/src/format/frontmatter.ts).
 *
 * Pure string parsing — no storage. Defensive content-dir mocks per the repo's
 * test-isolation convention. The empty-frontmatter case is the regression guard
 * for js-yaml 5, whose load('') throws where 4 returned undefined.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), 'bakin-test-frontmatter')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { parseFrontmatter, splitFrontmatter } from '../../../packages/core/src/format/frontmatter'

describe('splitFrontmatter', () => {
  it('returns the raw block and the trimmed body', () => {
    expect(splitFrontmatter('---\nname: Skill\n---\n\nBody text\n')).toEqual({ raw: 'name: Skill', body: 'Body text' })
  })

  it('returns a null block when there is no fence', () => {
    expect(splitFrontmatter('Just a body\n')).toEqual({ raw: null, body: 'Just a body' })
  })
})

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter into an object', () => {
    expect(parseFrontmatter('---\nname: Skill\ntags: [a, b]\n---\nBody')).toEqual({
      frontmatter: { name: 'Skill', tags: ['a', 'b'] },
      body: 'Body',
    })
  })

  it('treats an empty frontmatter block as no frontmatter, keeping the body', () => {
    expect(parseFrontmatter('---\n\n---\nBody only')).toEqual({ frontmatter: {}, body: 'Body only' })
  })

  it('treats a whitespace-only frontmatter block the same way', () => {
    expect(parseFrontmatter('---\n   \n---\nBody only')).toEqual({ frontmatter: {}, body: 'Body only' })
  })

  it('falls back to the whole content as body when the YAML is invalid', () => {
    const content = '---\nname: [unclosed\n---\nBody'
    expect(parseFrontmatter(content)).toEqual({ frontmatter: {}, body: content.trim() })
  })

  it('returns empty frontmatter when there is no fence', () => {
    expect(parseFrontmatter('No fence here')).toEqual({ frontmatter: {}, body: 'No fence here' })
  })
})
