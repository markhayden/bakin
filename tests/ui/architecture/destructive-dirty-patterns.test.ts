import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Components from '@makinbakin/sdk/components'
import * as Navigation from '@makinbakin/sdk/navigation'
import * as Patterns from '@makinbakin/sdk/patterns'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('canonical destructive and dirty-state patterns', () => {
  it('publishes one presentation identity through focused and compatibility entrypoints', () => {
    expect(Patterns.ConfirmDialog).toBe(PrivatePatterns.ConfirmDialog)
    expect(Patterns.SaveBar).toBe(PrivatePatterns.SaveBar)
    expect(Patterns.DangerZone).toBe(PrivatePatterns.DangerZone)
    expect(Patterns.UnsavedChangesDialog).toBe(PrivatePatterns.UnsavedChangesDialog)
    expect(Components.ConfirmDialog).toBe(PrivatePatterns.ConfirmDialog)
    expect(Components.SaveBar).toBe(PrivatePatterns.SaveBar)
    expect(Components.DangerZone).toBe(PrivatePatterns.DangerZone)
    expect(Components.useUnsavedChangesGuard).toBe(Navigation.useUnsavedChangesGuard)
  })

  it('keeps presentation free of routing, persistence, and legacy host styling', () => {
    const sources = [
      'packages/ui/src/patterns/confirm-dialog.tsx',
      'packages/ui/src/patterns/save-bar.tsx',
      'packages/ui/src/patterns/danger-zone.tsx',
      'packages/ui/src/patterns/unsaved-changes-dialog.tsx',
    ].map(read).join('\n')
    expect(sources).not.toMatch(/@tanstack|window\.|document\.|localStorage|sessionStorage|fetch\(/)
    expect(sources).not.toMatch(/@\/components|@\/lib|lucide-react/)
    expect(sources).not.toMatch(/(?:bg|text|border)-(?:red|yellow|green|blue|gray|zinc|slate)-/)
  })

  it('retains the shipped TanStack, anchor, and hard-navigation guard contract', () => {
    const guard = read('packages/sdk/src/navigation/unsaved-changes-guard.tsx')
    const navigationGate = read('tests/architecture/no-hard-navigation.test.ts')
    expect(guard).toContain("from '@bakin/ui/patterns'")
    expect(guard).toContain('tanStackRouter.history.block')
    expect(guard).toContain("document.addEventListener('click'")
    expect(guard).toContain('window.location.assign(href)')
    expect(guard).toContain('current.pathname === next.pathname')
    expect(navigationGate).toContain("rel === 'packages/sdk/src/navigation/unsaved-changes-guard.tsx'")
  })

  it('documents retry, mobile ordering, and the existing routing exception', () => {
    const story = read('storybook/public/patterns/destructive-dirty.stories.tsx')
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    expect(story).toContain("title: 'Patterns/Destructive and dirty state'")
    expect(story).toContain('Retry save')
    expect(story).toContain("from '@makinbakin/sdk/navigation'")
    expect(guide).toContain('Destructive and Dirty-State Recipe')
    expect(guide).toContain('recent routing work')
    expect(guide).toContain('pinned exception')
  })
})
