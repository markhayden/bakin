import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Patterns from '@makinbakin/sdk/patterns'
import * as HostPatterns from '../../../packages/host/src/ui/page-archetypes'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')

describe('canonical list and detail page archetypes', () => {
  it('owns presentation in the private package and publishes one focused implementation', () => {
    const files = [
      'packages/ui/src/patterns/page-header.tsx',
      'packages/ui/src/patterns/list-page.tsx',
      'packages/ui/src/patterns/detail-page.tsx',
      'packages/ui/src/patterns/index.ts',
    ]
    for (const file of files) expect(existsSync(resolve(REPO_ROOT, file))).toBe(true)

    const source = files.map(read).join('\n')
    expect(source).not.toMatch(/from ['"]@\//)
    expect(source).not.toContain('@makinbakin/sdk')
    expect(source).not.toMatch(/src\/components/)
    expect(source).not.toMatch(/useRouter|useSearchParams|PluginLink|window\.|document\./)

    expect(Patterns.PageHeader).toBe(PrivatePatterns.PageHeader)
    expect(Patterns.ListPage).toBe(PrivatePatterns.ListPage)
    expect(Patterns.DetailPage).toBe(PrivatePatterns.DetailPage)
    expect(HostPatterns.PageHeader).toBe(PrivatePatterns.PageHeader)
    expect(HostPatterns.ListPage).toBe(PrivatePatterns.ListPage)
    expect(HostPatterns.DetailPage).toBe(PrivatePatterns.DetailPage)
    expect(read('packages/sdk/src/patterns/index.ts')).toContain("from '@bakin/ui/patterns'")
    expect(read('packages/ui/src/index.ts')).not.toMatch(/from ['"]\.\/patterns['"]/)
    expect(read('packages/sdk/src/components/index.ts')).not.toMatch(/export\s+\{[^}]*\b(?:PageHeader|ListPage|DetailPage)\b/)
  })

  it('keeps recipe choices finite and excludes application state and nested scrolling', () => {
    const source = [
      read('packages/ui/src/patterns/page-header.tsx'),
      read('packages/ui/src/patterns/list-page.tsx'),
      read('packages/ui/src/patterns/detail-page.tsx'),
    ].join('\n')

    expect(source).toContain("'wide' | 'full'")
    expect(source).toContain("'content' | 'wide'")
    expect(source).toContain("'single' | 'aside'")
    expect(source).not.toMatch(/(?:filter|query|search|route|fetch|items|data)\??:/i)
    expect(source).not.toMatch(/overflow-y-(?:auto|scroll)|h-screen|max-h-/)
    expect(source).not.toMatch(/width\??:\s*(?:string|number)/)
  })

  it('documents the existing routing contract instead of creating a competing one', () => {
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    const example = read('tests/ui/patterns/page-archetypes.types.tsx')

    expect(guide).toContain('paths identify pages')
    expect(guide).toContain('query parameters represent overlays, tabs, filters')
    expect(guide).toContain('PluginLink')
    expect(guide).toContain('useRouter()')
    expect(example).toContain("from '@makinbakin/sdk/patterns'")
    expect(example).toContain("from '@makinbakin/sdk/hooks'")
    expect(example).toContain("from '@makinbakin/sdk/components'")
    expect(example).not.toContain('window.location')
  })
})
