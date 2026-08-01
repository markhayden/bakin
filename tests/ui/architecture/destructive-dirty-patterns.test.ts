import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Patterns from '@makinbakin/sdk/patterns'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('canonical destructive and dirty-state patterns', () => {
  it('publishes one presentation identity through the focused entrypoint only', () => {
    expect(Patterns.ConfirmDialog).toBe(PrivatePatterns.ConfirmDialog)
    expect(Patterns.SaveBar).toBe(PrivatePatterns.SaveBar)
    expect(Patterns.DangerZone).toBe(PrivatePatterns.DangerZone)
    expect(Patterns.UnsavedChangesDialog).toBe(PrivatePatterns.UnsavedChangesDialog)
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
    const confirmStory = read('storybook/public/feedback/confirm-dialog.stories.tsx')
    const dangerStory = read('storybook/public/feedback/danger-zone.stories.tsx')
    const saveBarStory = read('storybook/public/forms/save-bar.stories.tsx')
    const exitStory = read('storybook/public/forms/unsaved-changes-dialog.stories.tsx')
    const recipeStory = read('storybook/public/recipes/destructive-settings-flow.stories.tsx')
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    expect(confirmStory).toContain("title: 'Feedback/ConfirmDialog'")
    expect(dangerStory).toContain("title: 'Feedback/DangerZone'")
    expect(saveBarStory).toContain("title: 'Forms/SaveBar'")
    expect(exitStory).toContain("title: 'Forms/UnsavedChangesDialog'")
    expect(recipeStory).toContain("title: 'Recipes/Destructive settings flow'")
    expect(saveBarStory).toContain('Retry save')
    expect(exitStory).toContain("from '@makinbakin/sdk/navigation'")
    expect(guide).toContain('Destructive and Dirty-State Recipe')
    expect(guide).toContain('recent routing work')
    expect(guide).toContain('pinned exception')
  })
})
