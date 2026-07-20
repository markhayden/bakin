import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Patterns from '@makinbakin/sdk/patterns'
import * as HostPatterns from '../../../packages/host/src/ui/page-archetypes'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')

describe('canonical settings and dashboard page archetypes', () => {
  it('publishes one private implementation through the focused SDK and host bridges', () => {
    const files = [
      'packages/ui/src/patterns/settings-page.tsx',
      'packages/ui/src/patterns/dashboard-page.tsx',
    ]
    for (const file of files) expect(existsSync(resolve(REPO_ROOT, file))).toBe(true)

    const source = files.map(read).join('\n')
    expect(source).not.toMatch(/from ['"]@\//)
    expect(source).not.toContain('@makinbakin/sdk')
    expect(source).not.toMatch(/src\/components/)
    expect(source).not.toMatch(/useRouter|useSearchParams|PluginLink|window\.|document\./)

    expect(Patterns.SettingsPage).toBe(PrivatePatterns.SettingsPage)
    expect(Patterns.DashboardPage).toBe(PrivatePatterns.DashboardPage)
    expect(HostPatterns.SettingsPage).toBe(PrivatePatterns.SettingsPage)
    expect(HostPatterns.DashboardPage).toBe(PrivatePatterns.DashboardPage)
  })

  it('keeps recipe choices finite and excludes domain state, nested landmarks, and nested scrolling', () => {
    const source = [
      read('packages/ui/src/patterns/settings-page.tsx'),
      read('packages/ui/src/patterns/dashboard-page.tsx'),
    ].join('\n')

    expect(source).toContain("'content' | 'wide'")
    expect(source).toContain("'wide' | 'full'")
    expect(source).toContain("'single' | 'navigation'")
    expect(source).not.toMatch(/(?:schema|telemetry|metric|health|provider|route|fetch|data)\??:/i)
    expect(source).not.toMatch(/<main|overflow-y-(?:auto|scroll)|h-screen|max-h-/)
    expect(source).not.toMatch(/width\??:\s*(?:string|number)/)
  })

  it('documents composition and the existing URL-state contract without duplicating later dirty-state work', () => {
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    const example = read('tests/ui/patterns/settings-dashboard-archetypes.types.tsx')

    expect(guide).toContain('Settings and Dashboard Page Recipes')
    expect(guide).toContain('settings category')
    expect(guide).toContain('dashboard view state')
    expect(guide).toContain('query parameters')
    expect(guide).toContain('FormActions')
    expect(example).toContain("from '@makinbakin/sdk/patterns'")
    expect(example).toContain("from '@makinbakin/sdk/layout'")
    expect(example).toContain("from '@makinbakin/sdk/ui'")
    expect(example).not.toContain('window.location')
  })
})
