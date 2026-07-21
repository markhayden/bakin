import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('public markdown and focused search patterns', () => {
  it('isolates the heavy Markdown engine behind the focused content entrypoint', () => {
    const publicComponents = read('packages/sdk/src/components/index.ts')
    const focusedContent = read('packages/sdk/src/content/index.ts')
    const focusedPatterns = read('packages/sdk/src/patterns/index.ts')
    const content = read('packages/sdk/src/content/markdown-content.tsx')
    const editor = read('packages/sdk/src/content/markdown-editor.tsx')
    expect(publicComponents).toContain('MarkdownContent')
    expect(publicComponents).toContain('MarkdownEditor')
    expect(focusedContent).toContain('MarkdownContent')
    expect(focusedContent).toContain('MarkdownEditor')
    expect(focusedPatterns).not.toContain('MarkdownContent')
    expect(focusedPatterns).not.toContain('MarkdownEditor')
    expect(content).not.toMatch(/@\/|lucide-react/)
    expect(editor).not.toMatch(/@\/|lucide-react/)
    expect(read('src/components/markdown-content.tsx')).toContain("@makinbakin/sdk/content")
    expect(read('src/components/markdown-editor.tsx')).toContain("@makinbakin/sdk/content")
  })

  it('publishes search trust through focused patterns with components compatibility', () => {
    const publicComponents = read('packages/sdk/src/components/index.ts')
    const focusedPatterns = read('packages/sdk/src/patterns/index.ts')
    const search = read('packages/sdk/src/patterns/search-patterns.tsx')
    expect(publicComponents).toContain('SearchUnavailable')
    expect(publicComponents).toContain('SearchPartialChip')
    expect(publicComponents).toContain('SearchDegradedChip')
    expect(publicComponents).toContain('ScoreOverlay')
    expect(focusedPatterns).toContain('SearchUnavailable')
    expect(focusedPatterns).toContain('SearchPartialChip')
    expect(focusedPatterns).toContain('SearchDegradedChip')
    expect(focusedPatterns).toContain('ScoreOverlay')
    expect(search).not.toMatch(/@\/|lucide-react|text-(amber|cyan|purple|pink|emerald|orange|sky|zinc)-/)
    for (const file of [
      'search-unavailable.tsx',
      'search-partial-chip.tsx',
      'search-degraded-chip.tsx',
      'score-overlay.tsx',
    ]) {
      expect(read(`src/components/${file}`)).toContain('@makinbakin/sdk/patterns')
    }
  })
})
