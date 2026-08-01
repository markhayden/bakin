import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../../..')

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const migratedComponents = [
  'plugins/team/components/active-context-tab.tsx',
  'plugins/team/components/adopt-dialog.tsx',
  'plugins/team/components/agent-detail.tsx',
  'plugins/team/components/agent-form.tsx',
  'plugins/team/components/diagnostics-tab.tsx',
  'plugins/team/components/heartbeat-tab.tsx',
  'plugins/team/components/lesson-toggle-list.tsx',
  'plugins/team/components/markdown-edit-tab.tsx',
  'plugins/team/components/overview-tab.tsx',
  'plugins/team/components/package-card.tsx',
  'plugins/team/components/package-state-badge.tsx',
  'plugins/team/components/team-detail.tsx',
  'plugins/team/components/team-grid.tsx',
  'plugins/team/components/team-manager.tsx',
] as const

describe('Team UI conformance', () => {
  it('uses focused public SDK entrypoints and semantic colors across migrated surfaces', () => {
    for (const path of migratedComponents) {
      const contents = source(path)

      expect(contents).not.toContain('@makinbakin/sdk/components')
      expect(contents).not.toMatch(
        /\b(?:red|rose|amber|yellow|green|emerald|teal|cyan|blue|sky|violet|purple|zinc)-\d+/,
      )
      expect(contents).not.toMatch(/<(?:button|input|select|textarea)\b/)
      expect(contents).not.toMatch(
        /\b(?:w|min-w|max-w|h|min-h|max-h|text|p|px|py|m|mx|my|gap|grid-cols|tracking)-\[[^\]]+\]/,
      )
      expect(contents).not.toMatch(/\bstyle=\{/)
    }
  })

  it('composes the org chart from the shared workflow canvas without replacing React Flow mechanics', () => {
    const contents = source('plugins/team/components/team-grid.tsx')
    const graphStyles = source('plugins/team/components/team-graph.css')

    expect(contents).toContain("from '@makinbakin/sdk/patterns'")
    expect(contents).toContain("from '@xyflow/react'")
    expect(contents).toContain('<WorkspacePage')
    expect(contents).toContain('<WorkspacePageHeader')
    expect(contents).toContain('<WorkspacePageBody')
    expect(contents).toContain('<PageCanvas')
    expect(contents).toContain('<ReactFlow')
    expect(contents).toContain('orientation="vertical"')
    expect(graphStyles).toContain('[data-bakin-plugin="team"]')
    expect(graphStyles).not.toMatch(/(?:^|,\s*)(?:html|body|:root)(?:\b|\s|,)/m)
  })

  it('uses the canonical full-width detail shell, tabs, feedback, and destructive confirmation', () => {
    const contents = source('plugins/team/components/agent-detail.tsx')

    expect(contents).toContain('<Page data-agent-detail')
    expect(contents).toContain('<PageHeader')
    expect(contents).toContain('<TabsList variant="underline"')
    expect(contents).toContain('<PageBody')
    expect(contents).toContain('<SystemState')
    expect(contents).toContain('<ConfirmDialog')
    expect(contents).not.toMatch(/<button\b/)
  })

  it('uses shared editor, save, settings, and status patterns throughout detail tabs', () => {
    const markdown = source('plugins/team/components/markdown-edit-tab.tsx')
    const lessons = source('plugins/team/components/lesson-toggle-list.tsx')
    const diagnostics = source('plugins/team/components/diagnostics-tab.tsx')

    expect(markdown).toContain("from '@makinbakin/sdk/content'")
    expect(markdown).toContain('<MarkdownEditor')
    expect(markdown).toContain('<SaveBar')
    expect(lessons).toContain('<Switch')
    expect(lessons).toContain('size="sm"')
    expect(lessons).toContain('<ListRows')
    expect(lessons).toContain('<ListRow')
    expect(diagnostics).toContain("from '@makinbakin/sdk/charts'")
    expect(diagnostics).toContain('<SegmentedControl')
    expect(diagnostics).toContain('<Progress')
    expect(diagnostics).toContain('<SystemState')
  })

  it('uses canonical form and drawer contracts for agent and team management', () => {
    const agentForm = source('plugins/team/components/agent-form.tsx')
    const manager = source('plugins/team/components/team-manager.tsx')
    const adopt = source('plugins/team/components/adopt-dialog.tsx')

    expect(agentForm).toContain('<Form')
    expect(agentForm).toContain('<Field')
    expect(agentForm).toContain('<FormActions')
    expect(manager).toContain('<DrawerSection')
    expect(manager).toContain('<AgentSelect')
    expect(manager).toContain('<ConfirmDialog')
    expect(adopt).toContain('<Form')
    expect(adopt).toContain('<Alert')
  })

  it('keeps shared context on the canonical interior-page and dirty-state contracts', () => {
    const contents = source('plugins/team/components/team-detail.tsx')

    expect(contents).toContain('<Page>')
    expect(contents).toContain('<PageHeader')
    expect(contents).toContain('<PageAside')
    expect(contents).toContain('<SaveBar')
    expect(contents).toContain('<StatusBadge')
    expect(contents).not.toMatch(/<button\b/)
    expect(contents).not.toMatch(/<textarea\b/)
  })
})
