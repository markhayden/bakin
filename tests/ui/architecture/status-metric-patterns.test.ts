import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
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

  it('the legacy status and metric compatibility adapters stay deleted (P-final)', () => {
    expect(existsSync(resolve(ROOT, 'src/components/status-badge.tsx'))).toBe(false)
    expect(existsSync(resolve(ROOT, 'src/components/stat-tile.tsx'))).toBe(false)
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
