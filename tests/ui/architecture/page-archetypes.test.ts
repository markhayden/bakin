import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Patterns from '@makinbakin/sdk/patterns'
import * as HostPatterns from '../../../packages/host/src/ui/page-archetypes'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')

const FAMILY_FILES = [
  'packages/ui/src/patterns/page-header.tsx',
  'packages/ui/src/patterns/page.tsx',
  'packages/ui/src/patterns/page-body.tsx',
  'packages/ui/src/patterns/page-controls.tsx',
  'packages/ui/src/patterns/page-aside.tsx',
  'packages/ui/src/patterns/page-canvas.tsx',
  'packages/ui/src/patterns/page-composer.tsx',
  'packages/ui/src/patterns/index.ts',
]

describe('canonical consolidated page archetype', () => {
  it('owns presentation in the private package and publishes one focused implementation', () => {
    for (const file of FAMILY_FILES) expect(existsSync(resolve(REPO_ROOT, file))).toBe(true)

    const source = FAMILY_FILES.map(read).join('\n')
    expect(source).not.toMatch(/from ['"]@\//)
    expect(source).not.toContain('@makinbakin/sdk')
    expect(source).not.toMatch(/src\/components/)
    expect(source).not.toMatch(/useRouter|useSearchParams|PluginLink|window\.|document\./)

    // ONE implementation behind every bridge: SDK, private package, and host.
    for (const name of ['PageHeader', 'Page', 'PageBody', 'PageControls', 'PageAside', 'PageCanvas', 'PageTimeline', 'PageComposer'] as const) {
      expect(Patterns[name]).toBe(PrivatePatterns[name])
      expect(HostPatterns[name]).toBe(PrivatePatterns[name])
    }
    expect(read('packages/sdk/src/patterns/index.ts')).toContain("from '@bakin/ui/patterns'")
    expect(read('packages/ui/src/index.ts')).not.toMatch(/from ['"]\.\/patterns['"]/)
    // P-final: the frozen components barrel is gone entirely.
    expect(existsSync(resolve(REPO_ROOT, 'packages/sdk/src/components'))).toBe(false)
  })

  it('retired the six legacy archetype roots without leaving aliases behind', () => {
    for (const file of [
      'packages/ui/src/patterns/list-page.tsx',
      'packages/ui/src/patterns/detail-page.tsx',
      'packages/ui/src/patterns/settings-page.tsx',
      'packages/ui/src/patterns/dashboard-page.tsx',
      'packages/ui/src/patterns/conversation-page.tsx',
      'packages/ui/src/patterns/workflow-page.tsx',
    ]) {
      expect(existsSync(resolve(REPO_ROOT, file))).toBe(false)
    }
    const barrels = [read('packages/ui/src/patterns/index.ts'), read('packages/sdk/src/patterns/index.ts')].join('\n')
    expect(barrels).not.toMatch(/\b(?:List|Detail|Settings|Dashboard|Conversation|Workflow)Page\b/)
  })

  it('keeps recipe choices finite and excludes application state and nested scrolling', () => {
    const source = [
      read('packages/ui/src/patterns/page-header.tsx'),
      read('packages/ui/src/patterns/page.tsx'),
      read('packages/ui/src/patterns/page-body.tsx'),
      read('packages/ui/src/patterns/page-controls.tsx'),
      read('packages/ui/src/patterns/page-aside.tsx'),
    ].join('\n')

    expect(source).toContain("'standard' | 'full'")
    expect(source).toContain("'page' | 'contained'")
    expect(source).toContain("'default' | 'compact'")
    expect(source).toContain("'single' | 'aside'")
    expect(source).toContain("'section' | 'toolbar'")
    expect(source).not.toMatch(/(?:filter|query|search|route|fetch|items|data)\??:/i)
    expect(source).not.toMatch(/overflow-y-(?:auto|scroll)|h-screen|max-h-/)
    expect(source).not.toMatch(/width\??:\s*(?:string|number)/)
  })

  it('documents the existing routing contract instead of creating a competing one', () => {
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    const example = read('tests/ui/patterns/page.types.tsx')

    expect(guide).toContain('paths identify pages')
    expect(guide).toContain('query parameters represent overlays, tabs, filters')
    expect(guide).toContain('PluginLink')
    expect(guide).toContain('useRouter()')
    expect(example).toContain("from '@makinbakin/sdk/patterns'")
    expect(example).toContain("from '@makinbakin/sdk/navigation'")
    expect(example).not.toContain('window.location')
  })
})
