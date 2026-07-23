import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('canonical status and metric patterns', () => {
  it('keeps presentation-only status and metric code in the private UI package', () => {
    const sources = [
      read('packages/ui/src/patterns/status-badge.tsx'),
      read('packages/ui/src/patterns/stat-group.tsx'),
      read('packages/ui/src/patterns/stat-tile.tsx'),
    ].join('\n')
    expect(sources).not.toMatch(/@\/|@makinbakin\/sdk|lucide-react|window\.|document\./)
    expect(sources).not.toMatch(/(?:bg|text|border)-(?:red|yellow|green|blue|gray|zinc|slate)-/)
  })

  it('keeps legacy tone names and surface defaults inside compatibility adapters', () => {
    const statusAdapter = read('src/components/status-badge.tsx')
    const statAdapter = read('src/components/stat-tile.tsx')
    expect(statusAdapter).toContain("warning: 'attention'")
    expect(statusAdapter).toContain("destructive: 'danger'")
    expect(statAdapter).toContain('variant="surface"')
  })

  it('documents visible status language, meter labels, and the low-chrome default', () => {
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    expect(guide).toContain('StatusBadge')
    expect(guide).toContain('StatGroup')
    expect(guide).toContain('visible label')
    expect(guide).toContain('progress.label')
    expect(guide).toContain('low-chrome')
  })
})
