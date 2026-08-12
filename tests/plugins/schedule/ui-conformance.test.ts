import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../../..')

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('Schedule UI conformance', () => {
  it('composes the schedule index from focused public page patterns', () => {
    const contents = source('plugins/schedule/components/schedule-page.tsx')

    expect(contents).not.toContain('@makinbakin/sdk/components')
    expect(contents).toContain("from '@makinbakin/sdk/navigation'")
    expect(contents).toContain("from '@makinbakin/sdk/patterns'")
    // The tasks frame: immersive FLOW workspace — one page scroll, no
    // nested vertical scroll regions — with the sticky compact row.
    expect(contents).toContain('<WorkspacePage mode="immersive" flow')
    expect(contents).toContain('<WorkspacePageCompactHeader')
    expect(contents).not.toContain('overflow-auto')
    expect(contents).toContain('<PageHeader')
    expect(contents).toContain('<SearchInput')
    expect(contents).toContain('<PageControls')
    expect(contents).toContain('<PageBody')
    expect(contents).not.toMatch(/<button\b/)
    // No SegmentedControl internals overrides — the kit owns tab padding.
    expect(contents).not.toContain('[role=tab]')
  })

  it('composes the kit DataTable dual render rather than hand-rolled table/list branches', () => {
    const contents = source('plugins/schedule/components/job-list.tsx')

    expect(contents).not.toContain('@makinbakin/sdk/components')
    expect(contents).not.toContain('<EmptyState')
    expect(contents).toContain('<DataTable')
    expect(contents).toContain('renderRow=')
    // Wide-row activation is the kit DataTable contract — never a hand-rolled
    // interactive TableRow through the renderTableRow escape.
    expect(contents).not.toContain('renderTableRow=')
    expect(contents).toContain('onRowActivate=')
    expect(contents).toContain('rowActivateLabel=')
    expect(contents).toContain('<ListRow')
    // Whole-row activation rides the ListRow interactive contract, never a
    // ghost Button stretched across the row.
    expect(contents).toContain('interactive={{')
    expect(contents).not.toMatch(/\b(?:w|min-w|max-w)-\[[^\]]+\]/)
    // The dual render is container-query driven inside DataTable — no viewport branches.
    expect(contents).not.toContain('md:hidden')
  })

  it('uses canonical status and action semantics with kit-owned row activation', () => {
    const contents = source('plugins/schedule/components/job-row.tsx')

    expect(contents).not.toContain('@makinbakin/sdk/components')
    expect(contents).toContain('variant="solid"')
    expect(contents).toContain('variant="danger"')
    // Row keyboard activation is DataTable-owned — no hand-rolled handlers.
    expect(contents).not.toContain('onKeyDown=')
    expect(contents).not.toContain('tabIndex')
    // Debug relevance scores ride the shared data-series palette.
    expect(contents).toContain('text-bakin-data-series-1')
    expect(contents).not.toMatch(/\b(?:red|amber|cyan|purple|zinc|emerald|blue)-\d+/)
    expect(contents).not.toMatch(/text-\[(?:\d|\.)/)
  })

  it('uses semantic calendar surfaces instead of raw agent glow palettes', () => {
    const calendarPaths = [
      'plugins/schedule/components/calendar-today.tsx',
      'plugins/schedule/components/calendar-weekly.tsx',
      'plugins/schedule/components/calendar-monthly.tsx',
    ]

    for (const path of calendarPaths) {
      const contents = source(path)
      expect(contents).not.toMatch(/<button\b/)
      expect(contents).not.toMatch(/\b(?:red|rose|amber|yellow|green|emerald|teal|cyan|blue|violet|purple|zinc|white)-\d+/)
      expect(contents).not.toMatch(/\bstyle=\{/)
      expect(contents).not.toMatch(/(?:text|min-h|w|h|pl|grid-cols)-\[(?:\d|\.)/)
    }

    expect(existsSync(resolve(repoRoot, 'plugins/schedule/components/agent-colors.ts'))).toBe(false)
  })

  it('uses focused identity, popover, dialog, and form contracts for events', () => {
    const badge = source('plugins/schedule/components/agent-badge.tsx')
    const event = source('plugins/schedule/components/event-popover.tsx')

    expect(badge).not.toContain('@makinbakin/sdk/components')
    expect(badge).toContain("from '@makinbakin/sdk/patterns'")
    expect(event).not.toContain('@makinbakin/sdk/components')
    expect(event).toContain("from '@makinbakin/sdk/patterns'")
    expect(event).toContain("from '@makinbakin/sdk/navigation'")
    expect(event).toContain('<PluginLink')
    expect(event).not.toMatch(/<a\b/)
    expect(event).toContain('<PopoverHeader')
    expect(event).toContain('<Field')
    expect(event).not.toMatch(/\b(?:red|rose|teal|zinc)-\d+/)
    expect(event).not.toMatch(/text-\[(?:\d|\.)/)
  })

  it('composes the job drawer from canonical sections, identity, and status patterns', () => {
    const contents = source('plugins/schedule/components/job-drawer.tsx')

    expect(contents).not.toContain('@makinbakin/sdk/components')
    expect(contents).toContain("from '@makinbakin/sdk/patterns'")
    expect(contents).toContain('<DrawerSection')
    expect(contents).toContain('<StatusBadge')
    expect(contents).not.toMatch(/\bstyle=\{/)
    expect(contents).not.toMatch(/\b(?:red|rose|amber|yellow|green|emerald|teal|cyan|blue|sky|violet|purple|zinc)-\d+/)
    expect(contents).not.toMatch(/text-\[(?:\d|\.)/)
  })

  it('uses canonical form, field, selection, and feedback contracts for job editing', () => {
    const form = source('plugins/schedule/components/job-form.tsx')
    const scheduleInput = source('plugins/schedule/components/schedule-input.tsx')
    const pause = source('plugins/schedule/components/pause-controls.tsx')

    expect(form).not.toContain('@makinbakin/sdk/components')
    expect(form).toContain("from '@makinbakin/sdk/patterns'")
    expect(form).toContain('<Form')
    expect(form).toContain('<Field')
    expect(form).toContain('<FormActions')
    expect(form).toContain('<Checkbox')
    expect(form).not.toMatch(/<button\b/)
    expect(form).not.toMatch(/<input\b/)
    expect(scheduleInput).toContain('<SegmentedControl')
    expect(scheduleInput).toContain('<FieldError')
    expect(scheduleInput).not.toMatch(/<button\b/)
    expect(pause).toContain('<Field')
    expect(pause).not.toMatch(/\b(?:red|amber|zinc)-\d+/)
  })

  it('renders run history with canonical states and status badges', () => {
    const contents = source('plugins/schedule/components/run-history.tsx')

    expect(contents).toContain('<StatusBadge')
    expect(contents).toContain('<SystemState')
    expect(contents).toContain('<ListRows')
    expect(contents).toContain('<Pagination')
    expect(contents).not.toContain('toneBadgeClass')
    expect(contents).not.toMatch(/\b(?:red|amber|zinc)-\d+/)
    expect(contents).not.toMatch(/(?:text|w)-\[(?:\d|\.)/)
  })
})
