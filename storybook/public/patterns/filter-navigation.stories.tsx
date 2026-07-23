import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, within } from 'storybook/test'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import {
  AgentFilter,
  FacetFilter,
  SearchInput,
  SegmentedControl,
  SortableHead,
  UnderlineTabs,
  type SortDir,
} from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'
import { DEFAULT_STORY_FIXTURE } from '../../fixtures'

import './filter-navigation.stories.css'

const meta = {
  title: 'Patterns/Filters and navigation',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'SearchInput, FacetFilter, AgentFilter, SegmentedControl, UnderlineTabs, and SortableHead provide consistent query, selection, overflow, keyboard, and sorting semantics. Consumers own values and connect linkable state to the existing SDK query-state hooks.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'keyboard', 'counts', 'clearing', 'long-labels', 'focus-expansion', 'query-truncation', 'busy', 'reduced-motion', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const motionStoryFixture = { ...DEFAULT_STORY_FIXTURE, reducedMotion: false }
const longSearchQuery = 'blocked launch approval tasks with a deliberately long owner name'

function PatternStage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="bakin-filter-navigation-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-filter-navigation-story__intro">
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          {children}
        </Stack>
      </PageShell>
    </main>
  )
}

const states = [
  { value: 'running', label: 'Running' },
  { value: 'blocked', label: 'Needs attention because a dependency is unavailable' },
  { value: 'queued', label: 'Queued' },
  { value: 'complete', label: 'Complete' },
  { value: 'paused', label: 'Paused' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
] as const

function SearchInputExample({ initialQuery = '', busy = false }: { initialQuery?: string; busy?: boolean }) {
  const [query, setQuery] = useState(initialQuery)

  return (
    <PatternStage
      eyebrow="Query / compact discovery"
      title="Expand search without moving the page"
      description="The field starts compact, expands inside reserved space while focused, then shrinks to fit the current query up to its cap. Longer values remain intact behind an ellipsis and the canonical clear action."
    >
      <section aria-labelledby="search-input-heading" className="bakin-filter-navigation-story__section">
        <div>
          <h2 id="search-input-heading">Task search</h2>
          <p>A routed page stores the controlled query in the existing URL-state contract; this pattern only owns presentation.</p>
        </div>
        <SearchInput
          label="Search tasks"
          value={query}
          onValueChange={setQuery}
          placeholder="Search tasks…"
          busy={busy}
        />
        <p role="status" className="bakin-filter-navigation-story__status">
          {query ? `Current query: ${query}` : 'No query entered'}
        </p>
      </section>
    </PatternStage>
  )
}

export const SearchBehavior = {
  render: () => <SearchInputExample />,
  parameters: {
    bakinFixture: motionStoryFixture,
  },
  play: async ({ canvas }) => {
    const search = canvas.getByRole('searchbox', { name: 'Search tasks' })
    const control = search.closest('[data-slot="search-input-control"]') as HTMLElement

    await expect(control).toHaveAttribute('data-state', 'empty')
    await expect(search).toHaveValue('')
  },
} satisfies Story

export const LongQuery = {
  render: () => <SearchInputExample initialQuery={longSearchQuery} />,
  play: async ({ canvas }) => {
    const search = canvas.getByRole('searchbox', { name: 'Search tasks' })
    const control = search.closest('[data-slot="search-input-control"]') as HTMLElement

    await expect(control).toHaveAttribute('data-state', 'filled')
    await expect(search).toHaveValue(longSearchQuery)
    await expect(canvas.getByRole('button', { name: 'Clear Search tasks' })).toBeVisible()
  },
} satisfies Story

export const SearchInProgress = {
  render: () => <SearchInputExample initialQuery="blocked tasks" busy />,
  play: async ({ canvas }) => {
    const search = canvas.getByRole('searchbox', { name: 'Search tasks' })
    await expect(search).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.getByText('Searching Search tasks').closest('[role="status"]')).toBeTruthy()
    await expect(search.closest('[data-slot="search-input-control"]')?.querySelector('[data-slot="search-input-progress"]')).toBeTruthy()
  },
} satisfies Story

const stateCounts = {
  running: 12,
  blocked: 3,
  queued: 8,
  complete: 42,
  paused: 2,
  draft: 7,
  archived: 14,
}

function FacetFilteringExample() {
  const [selected, setSelected] = useState<string[]>(['blocked'])

  return (
    <PatternStage
      eyebrow="Results / multi-select"
      title="Keep filter state visible and reversible"
      description="Search appears for a longer option set, counts remain available in every result, and selected values can be removed individually or cleared together. A routed page stores the controlled value in query state."
    >
      <section aria-labelledby="task-filter-heading" className="bakin-filter-navigation-story__section">
        <div>
          <h2 id="task-filter-heading">Task filters</h2>
          <p>42 active tasks across agents, schedules, assets, and workflows.</p>
        </div>
        <FacetFilter
          label="State"
          options={states}
          selected={selected}
          counts={stateCounts}
          onChange={setSelected}
        />
        <p role="status" className="bakin-filter-navigation-story__status">
          {selected.length === 0 ? 'Showing every task state' : `Filtering by ${selected.join(', ')}`}
        </p>
      </section>
    </PatternStage>
  )
}

export const FacetFiltering = {
  render: () => <FacetFilteringExample />,
  play: async ({ canvas, userEvent }) => {
    const page = within(document.body)
    await userEvent.click(canvas.getByRole('button', { name: 'State, 1 selected' }))
    const search = page.getByRole('combobox', { name: 'Search State' })
    await userEvent.type(search, 'Running')
    await userEvent.click(page.getByRole('option', { name: 'Running 12' }))
    await expect(canvas.getByRole('button', { name: 'State, 2 selected' })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Clear State filters' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Showing every task state')
    await userEvent.clear(search)
    await userEvent.click(page.getByRole('option', { name: 'Needs attention because a dependency is unavailable 3' }))
    await expect(canvas.getByRole('button', { name: 'State, 1 selected' })).toBeVisible()
  },
} satisfies Story

const agents = [
  { value: 'patch', label: 'Patch', visual: <span className="bakin-filter-navigation-story__avatar">PA</span> },
  { value: 'pixel', label: 'Pixel', visual: <span className="bakin-filter-navigation-story__avatar">PX</span> },
  { value: 'rolo', label: 'Rolo', visual: <span className="bakin-filter-navigation-story__avatar">RO</span> },
] as const

function AgentFilteringExample() {
  const [agent, setAgent] = useState('all')
  const label = agent === 'all' ? 'all agents' : agents.find((option) => option.value === agent)?.label

  return (
    <PatternStage
      eyebrow="Results / one owner"
      title="Filter by an agent without losing names"
      description="The public pattern accepts presentation-ready options. Official surfaces can keep using the app-aware compatibility adapter for registered agent metadata and avatars."
    >
      <section aria-labelledby="agent-filter-heading" className="bakin-filter-navigation-story__section">
        <div><h2 id="agent-filter-heading">Assigned agent</h2><p>Arrow keys move and select within one horizontal radio group.</p></div>
        <AgentFilter options={agents} value={agent} onValueChange={setAgent} compact />
        <p role="status" className="bakin-filter-navigation-story__status">Showing work for {label}</p>
      </section>
    </PatternStage>
  )
}

export const AgentFiltering = {
  render: () => <AgentFilteringExample />,
  play: async ({ canvas, userEvent }) => {
    const all = canvas.getByRole('radio', { name: 'All' })
    all.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('radio', { name: 'Patch' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('status')).toHaveTextContent('Patch')
    await userEvent.keyboard('{Home}')
    await expect(all).toHaveAttribute('aria-checked', 'true')
  },
} satisfies Story

const views = [
  { value: 'board', label: 'Board' },
  { value: 'timeline', label: 'Timeline', disabled: true },
  { value: 'operations', label: 'Operational log with preserved context' },
] as const

function SegmentedNavigationExample() {
  const [view, setView] = useState<(typeof views)[number]['value']>('board')

  return (
    <PatternStage
      eyebrow="View / compact modes"
      title="Switch modes with one compact control"
      description="Long labels remain intact inside a locally scrollable tablist. Disabled modes are skipped by automatic arrow-key activation."
    >
      <section aria-labelledby="task-view-heading" className="bakin-filter-navigation-story__section">
        <div><h2 id="task-view-heading">Task view</h2><p>The active view belongs in the URL when it changes what a shared page link opens.</p></div>
        <SegmentedControl
          idPrefix="task-view"
          ariaLabel="Task view"
          options={views}
          value={view}
          onValueChange={setView}
        />
        {views.map((option) => (
          <div
            key={option.value}
            id={`task-view-panel-${option.value}`}
            role="tabpanel"
            aria-labelledby={`task-view-tab-${option.value}`}
            hidden={view !== option.value}
            className="bakin-filter-navigation-story__panel"
          >
            {option.label} is the active task view.
          </div>
        ))}
      </section>
    </PatternStage>
  )
}

export const SegmentedNavigation = {
  render: () => <SegmentedNavigationExample />,
  play: async ({ canvas, userEvent }) => {
    const board = canvas.getByRole('tab', { name: 'Board' })
    board.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Operational log with preserved context' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Operational log')
    await userEvent.keyboard('{Home}')
    await expect(board).toHaveAttribute('aria-selected', 'true')
  },
} satisfies Story

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity and recent operational history' },
  { id: 'system', label: 'System-managed details', disabled: true },
] as const

function UnderlineNavigationExample() {
  const [section, setSection] = useState('overview')

  return (
    <PatternStage
      eyebrow="Page / sections"
      title="Keep page sections anchored to their content"
      description="Underline tabs provide the quieter page-level treatment while retaining linked panels, roving focus, and narrow-width overflow."
    >
      <section aria-labelledby="runtime-heading" className="bakin-filter-navigation-story__section">
        <div><h2 id="runtime-heading">Runtime connection</h2><p>Section selection is controlled by the page and can be synchronized to query state.</p></div>
        <UnderlineTabs
          idPrefix="runtime"
          ariaLabel="Runtime sections"
          tabs={sections}
          value={section}
          onValueChange={setSection}
          rightSlot={<Button size="xs" variant="ghost">Export</Button>}
        />
        {sections.map((item) => (
          <div
            key={item.id}
            id={`runtime-panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`runtime-tab-${item.id}`}
            hidden={section !== item.id}
            className="bakin-filter-navigation-story__panel"
          >
            {item.label} content remains part of the runtime page.
          </div>
        ))}
      </section>
    </PatternStage>
  )
}

export const UnderlineNavigation = {
  render: () => <UnderlineNavigationExample />,
  play: async ({ canvas, userEvent }) => {
    const overview = canvas.getByRole('tab', { name: 'Overview' })
    overview.focus()
    await userEvent.keyboard('{End}')
    await expect(canvas.getByRole('tab', { name: 'Activity and recent operational history' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Activity and recent operational history')
    await userEvent.keyboard('{Home}')
    await expect(overview).toHaveAttribute('aria-selected', 'true')
  },
} satisfies Story

type SortField = 'task' | 'owner' | 'updated'

const rows = [
  { task: 'Review plugin migration guidance', owner: 'Patch', updated: '8 minutes ago' },
  { task: 'Verify workflow fallback actions', owner: 'Rolo', updated: '22 minutes ago' },
  { task: 'Reconcile provider usage', owner: 'Pixel', updated: '1 hour ago' },
]

function SortableTableExample() {
  const [field, setField] = useState<SortField>('updated')
  const [direction, setDirection] = useState<SortDir>('desc')
  const sort = (next: SortField) => {
    setDirection(next === field && direction === 'desc' ? 'asc' : 'desc')
    setField(next)
  }

  return (
    <PatternStage
      eyebrow="Table / ordering"
      title="Put sort meaning on the column header"
      description="The native header exposes the active direction while the nested button remains the keyboard-operable action."
    >
      <section aria-labelledby="sortable-work-heading" className="bakin-filter-navigation-story__section">
        <div><h2 id="sortable-work-heading">Active work</h2><p>Sort state stays explicit even when color and iconography are unavailable.</p></div>
        <div className="bakin-filter-navigation-story__table-scroll">
          <table>
            <thead>
              <tr>
                <SortableHead field="task" current={field} dir={direction} onSort={sort}>Task</SortableHead>
                <SortableHead field="owner" current={field} dir={direction} onSort={sort}>Owner</SortableHead>
                <SortableHead field="updated" current={field} dir={direction} onSort={sort}>Updated</SortableHead>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => <tr key={row.task}><th scope="row">{row.task}</th><td>{row.owner}</td><td>{row.updated}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </PatternStage>
  )
}

export const SortableTable = {
  render: () => <SortableTableExample />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(canvas.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'descending')
    await userEvent.click(canvas.getByRole('button', { name: 'Updated' }))
    await expect(canvas.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(canvas.getByRole('button', { name: 'Task' }))
    await expect(canvas.getByRole('columnheader', { name: 'Task' })).toHaveAttribute('aria-sort', 'descending')
    await userEvent.click(canvas.getByRole('button', { name: 'Updated' }))
    await expect(canvas.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'descending')
    const scroller = canvasElement.querySelector<HTMLElement>('.bakin-filter-navigation-story__table-scroll')
    if (scroller) scroller.scrollLeft = 0
  },
} satisfies Story
