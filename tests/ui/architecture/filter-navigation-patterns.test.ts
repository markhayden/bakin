import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('canonical filter and navigation patterns', () => {
  it('keeps generic presentation in the private UI package', () => {
    const sources = [
      'packages/ui/src/patterns/agent-filter.tsx',
      'packages/ui/src/patterns/facet-filter.tsx',
      'packages/ui/src/patterns/search-input.tsx',
      'packages/ui/src/patterns/segmented-control.tsx',
      'packages/ui/src/behaviors/selection-navigation.ts',
      'packages/ui/src/patterns/sortable-head.tsx',
    ].map(read).join('\n')
    expect(sources).not.toMatch(/@\/|@makinbakin\/sdk|lucide-react|useQueryState|window\.|document\./)
    expect(sources).not.toMatch(/(?:bg|text|border)-(?:red|yellow|green|blue|gray|zinc|slate)-/)
  })

  it('the barrel-era agent-filter compatibility adapter stays deleted (P-final)', () => {
    expect(existsSync(resolve(ROOT, 'src/components/agent-filter.tsx'))).toBe(false)
  })

  it('keeps URL ownership in consumers and examples on the shipped hooks', () => {
    const sources = [
      read('packages/ui/src/patterns/facet-filter.tsx'),
      read('packages/ui/src/patterns/segmented-control.tsx'),
    ].join('\n')
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    expect(sources).not.toMatch(/URLSearchParams|history\.|location\.|useQuery/)
    expect(guide).toContain("useQueryArrayState('status')")
    expect(guide).toContain("useQueryState('view', 'board')")
  })

  it('keeps in-flight search feedback inside the canonical field', () => {
    const search = read('packages/ui/src/patterns/search-input.tsx')
    const story = read('storybook/public/navigation/search-input.stories.tsx')
    const guide = read('docs/src/content/docs/extending/ui/overview.md')

    expect(search).toContain('busy?: boolean')
    expect(search).toContain('data-slot="search-input-progress"')
    expect(story).toContain('SearchInProgress')
    expect(guide).toContain('progress indicator stays inside the field')
  })
})
