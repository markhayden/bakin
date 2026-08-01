import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('public markdown and focused search patterns', () => {
  it('isolates the heavy Markdown engine behind the focused content entrypoint', () => {
    const focusedContent = read('packages/sdk/src/content/index.ts')
    const focusedPatterns = read('packages/sdk/src/patterns/index.ts')
    const content = read('packages/sdk/src/content/markdown-content.tsx')
    const editor = read('packages/sdk/src/content/markdown-editor.tsx')
    expect(focusedContent).toContain('MarkdownContent')
    expect(focusedContent).toContain('MarkdownEditor')
    expect(focusedPatterns).not.toContain('MarkdownContent')
    expect(focusedPatterns).not.toContain('MarkdownEditor')
    expect(content).not.toMatch(/@\/|lucide-react/)
    expect(editor).not.toMatch(/@\/|lucide-react/)
    // P-final: the barrel-era markdown adapters stay deleted.
    expect(existsSync(join(root, 'src/components/markdown-content.tsx'))).toBe(false)
    expect(existsSync(join(root, 'src/components/markdown-editor.tsx'))).toBe(false)
  })

  it('publishes search trust through the focused patterns entrypoint only', () => {
    const focusedPatterns = read('packages/sdk/src/patterns/index.ts')
    const search = read('packages/sdk/src/patterns/search-patterns.tsx')
    expect(focusedPatterns).toContain('SearchUnavailable')
    expect(focusedPatterns).toContain('SearchPartialChip')
    expect(focusedPatterns).toContain('SearchDegradedChip')
    expect(focusedPatterns).toContain('ScoreOverlay')
    expect(search).not.toMatch(/@\/|lucide-react|text-(amber|cyan|purple|pink|emerald|orange|sky|zinc)-/)
    // P-final: the barrel-era search-trust adapters stay deleted.
    for (const file of [
      'search-unavailable.tsx',
      'search-partial-chip.tsx',
      'search-degraded-chip.tsx',
      'score-overlay.tsx',
    ]) {
      expect(existsSync(join(root, `src/components/${file}`))).toBe(false)
    }
  })
})
