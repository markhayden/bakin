import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Patterns from '@makinbakin/sdk/patterns'
import * as HostPatterns from '../../../packages/host/src/ui/page-archetypes'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('canonical conversation and inspector archetypes', () => {
  it('publishes one presentation-only implementation', () => {
    for (const file of ['packages/ui/src/patterns/page-timeline.tsx', 'packages/ui/src/patterns/page-composer.tsx', 'packages/ui/src/patterns/inspector-panel.tsx', 'packages/ui/src/patterns/workspace-page.tsx']) {
      expect(existsSync(resolve(ROOT, file))).toBe(true)
    }
    const source = [read('packages/ui/src/patterns/page-timeline.tsx'), read('packages/ui/src/patterns/page-composer.tsx'), read('packages/ui/src/patterns/inspector-panel.tsx'), read('packages/ui/src/patterns/workspace-page.tsx')].join('\n')
    expect(source).not.toMatch(/from ['"]@\//)
    expect(source).not.toContain('@makinbakin/sdk')
    expect(source).not.toMatch(/fetch|EventSource|useRouter|useSearchParams|PluginLink/)
    expect(Patterns.PageTimeline).toBe(PrivatePatterns.PageTimeline)
    expect(Patterns.PageComposer).toBe(PrivatePatterns.PageComposer)
    expect(Patterns.InspectorPanel).toBe(PrivatePatterns.InspectorPanel)
    expect(Patterns.WorkspacePage).toBe(PrivatePatterns.WorkspacePage)
    expect(HostPatterns.PageTimeline).toBe(PrivatePatterns.PageTimeline)
    expect(HostPatterns.PageComposer).toBe(PrivatePatterns.PageComposer)
    expect(HostPatterns.InspectorPanel).toBe(PrivatePatterns.InspectorPanel)
    expect(HostPatterns.WorkspacePage).toBe(PrivatePatterns.WorkspacePage)
  })

  it('makes exceptional nested scrolling explicit and finite', () => {
    // The timeline scroller is the one page-owned internal scroller, active
    // only inside a contained Page (PageScrollContext).
    const timeline = read('packages/ui/src/patterns/page-timeline.tsx')
    const inspector = read('packages/ui/src/patterns/inspector-panel.tsx')
    expect(timeline).toContain('overflow-y-auto')
    expect(timeline).toContain("scroll === 'contained'")
    expect(inspector).not.toMatch(/overflow-y-(?:auto|scroll)|h-screen|max-h-/)
    expect(`${timeline}\n${inspector}`).not.toMatch(/(?:messages|thread|streamUrl|selected|node|resource|data)\??:/i)
  })

  it('documents the T30/T34 boundary and existing routing contract', () => {
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    expect(guide).toContain('Full-bleed Workspace Recipe')
    expect(guide).toContain('WorkspacePageHeader')
    expect(guide).toContain('Conversation and Inspector Recipes')
    expect(guide).toContain('message rendering')
    expect(guide).toContain('query parameters')
    expect(guide).toContain('Drawer')
  })
})
