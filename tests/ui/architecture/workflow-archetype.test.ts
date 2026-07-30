import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Patterns from '@makinbakin/sdk/patterns'
import * as HostPatterns from '../../../packages/host/src/ui/page-archetypes'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('canonical workflow archetype', () => {
  it('publishes one graph-library-independent presentation implementation', () => {
    const source = read('packages/ui/src/patterns/workflow-page.tsx')
    expect(source).not.toMatch(/@xyflow|ReactFlow|fetch|useRouter|useSearchParams|PluginLink/)
    expect(source).not.toMatch(/(?:nodes|edges|selected|definition|onSave|route|data)\??:/i)
    expect(Patterns.WorkflowPage).toBe(PrivatePatterns.WorkflowPage)
    expect(Patterns.WorkflowPageCanvas).toBe(PrivatePatterns.WorkflowPageCanvas)
    expect(HostPatterns.WorkflowPage).toBe(PrivatePatterns.WorkflowPage)
  })

  it('keeps orientation, layout, and scroll choices finite with vertical as the default', () => {
    const source = read('packages/ui/src/patterns/workflow-page.tsx')
    expect(source).toContain("'vertical' | 'horizontal'")
    expect(source).toContain("orientation = 'vertical'")
    expect(source).toContain("'canvas' | 'inspector'")
    expect(source).toContain("'document' | 'contained'")
    expect(source).toContain('BoundedOverflow')
    expect(source).not.toMatch(/h-screen|max-h-|overflow-y-(?:auto|scroll)/)
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

    expect(list).toContain('ListPage')
    expect(list).toContain('PageHeader')
    expect(list).toContain('SearchInput')
    expect(list).toContain('Pagination')
    expect(list).not.toContain('PluginHeader')

    for (const source of [detail, editor]) {
      expect(source).toContain('WorkspacePage')
      expect(source).toContain('WorkspacePageHeader')
      expect(source).toContain('WorkspacePageBody')
      expect(source).toContain('PageHeader')
      expect(source).toContain('WorkflowPageBody')
      expect(source).toContain('WorkflowPageCanvas')
      expect(source).toContain('mode="contained"')
      expect(source).not.toMatch(/<WorkflowPage(?:\s|>)/)
    }

    expect(detail).toContain('orientation="vertical"')
    expect(editor).toContain('orientation="vertical"')
    expect(editor).toContain('<ReactFlow')
  })
})
