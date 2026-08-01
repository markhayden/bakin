import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Patterns from '@makinbakin/sdk/patterns'
import * as HostPatterns from '../../../packages/host/src/ui/page-archetypes'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('canonical workflow canvas archetype slot', () => {
  it('publishes one graph-library-independent presentation implementation', () => {
    const canvas = read('packages/ui/src/patterns/page-canvas.tsx')
    expect(canvas).not.toMatch(/@xyflow|ReactFlow|fetch|useRouter|useSearchParams|PluginLink/)
    expect(canvas).not.toMatch(/(?:nodes|edges|selected|definition|onSave|route|data)\??:/i)
    expect(Patterns.PageCanvas).toBe(PrivatePatterns.PageCanvas)
    expect(HostPatterns.PageCanvas).toBe(PrivatePatterns.PageCanvas)
  })

  it('keeps orientation finite with vertical as the default and bounded overflow ownership', () => {
    const canvas = read('packages/ui/src/patterns/page-canvas.tsx')
    expect(canvas).toContain("'vertical' | 'horizontal'")
    expect(canvas).toContain("orientation = 'vertical'")
    expect(canvas).toContain('BoundedOverflow')
    expect(canvas).not.toMatch(/h-screen|max-h-|overflow-y-(?:auto|scroll)/)
  })

  it('uses real React Flow in the public evidence while retaining existing routing ownership', () => {
    const story = read('storybook/public/recipes/workflow-pages.stories.tsx')
    const graph = read('storybook/public/patterns/workflow-story-graph.tsx')
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    expect(graph).toContain("from '@xyflow/react'")
    expect(story).toContain('initialOrientation="vertical"')
    expect(story).toContain('initialOrientation="horizontal"')
    expect(guide).toContain('Workflow and Action Recipe')
    expect(guide).toContain('existing routing contract')
    expect(guide).toContain('query parameters')
  })

  it('keeps the official Workflows plugin on the canonical list and workflow shells', () => {
    const list = read('plugins/workflows/components/workflows-page.tsx')
    const detail = read('plugins/workflows/components/workflow-detail.tsx')
    const editor = read('plugins/workflows/components/workflow-canvas-editor.tsx')

    expect(list).toContain('<Page>')
    expect(list).toContain('PageBody')
    expect(list).toContain('PageHeader')
    expect(list).toContain('SearchInput')
    expect(list).toContain('Pagination')
    expect(list).not.toContain('PluginHeader')

    for (const source of [detail, editor]) {
      expect(source).toContain('WorkspacePage')
      expect(source).toContain('WorkspacePageHeader')
      expect(source).toContain('WorkspacePageBody')
      expect(source).toContain('PageHeader')
      expect(source).toContain('<PageBody')
      expect(source).toContain('<PageCanvas')
    }

    expect(detail).toContain('orientation="vertical"')
    expect(editor).toContain('orientation="vertical"')
    expect(editor).toContain('<ReactFlow')
  })
})
