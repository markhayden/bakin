import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'
import { expect } from 'storybook/test'
import { ArrowLeft, Download, Sparkles, Trash2 } from 'lucide-react'

import { Inline, Section, Stack } from '@makinbakin/sdk/layout'
import {
  Page,
  PageAside,
  PageBody,
  PageControls,
  PageHeader,
  Pagination,
  SearchInput,
  SegmentedControl,
} from '@makinbakin/sdk/patterns'
import {
  Badge,
  Banner,
  Button,
  DropdownMenuItem,
  Input,
  Label,
  SystemState,
} from '@makinbakin/sdk/ui'
import { DEFAULT_STORY_FIXTURE } from '../../fixtures'

import './page-archetypes.stories.css'

const meta = {
  title: 'Recipes/List and detail pages',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Index and record scenes compose the one Page archetype. Page fills the available plugin canvas by default; width="standard" is the deliberate bounded content measure for a focused record. PageControls names the query-control region, PageBody names results with explicit busy/feedback/replacement-state slots, and layout="aside" with PageAside is the one primary-column-plus-rail composition. Page uses host scrolling by default; set scroll="contained" only for a bounded workspace whose named child panes own scrolling. Header search, view controls, and primary actions remain deliberately stacked until the container has enough room for complete controls without internal scrolling. Consumers retain domain data and the existing SDK routing/query-state contract.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'system-states', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const motionStoryFixture = { ...DEFAULT_STORY_FIXTURE, reducedMotion: false }

const filters = ['All', 'Needs attention', 'Running', 'Blocked'] as const
type Filter = (typeof filters)[number]

function ListHeaderControlsExample() {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'board' | 'log'>('board')

  return (
    <Page className="bakin-archetype-story">
      <PageHeader
        title="Tasks"
        controlsLabel="Task search, view, and actions"
        controls={(
          <div className="grid w-full min-w-0 gap-bakin-2 @3xl/page-header:flex @3xl/page-header:items-start">
            <SearchInput
              align="end"
              label="Search tasks"
              value={query}
              onValueChange={setQuery}
              placeholder="Search tasks…"
              mobileFullWidth
              className="@3xl/page-header:w-[22rem] @3xl/page-header:shrink-0"
            />
            <div className="flex min-w-0 flex-wrap items-center gap-bakin-2 @3xl/page-header:shrink-0 @3xl/page-header:flex-nowrap">
              <SegmentedControl
                ariaLabel="Task view"
                size="md"
                value={view}
                onValueChange={setView}
                options={[{ value: 'board', label: 'Board' }, { value: 'log', label: 'Log' }]}
                className="shrink-0 [&_[role=tab]]:px-bakin-3"
              />
              <Button className="min-w-[7rem] flex-1 @3xl/page-header:flex-none">New task</Button>
            </div>
          </div>
        )}
      />
      <PageBody label="Task results">
        <div className="bakin-archetype-story__result-heading">
          <Stack gap="dense">
            <h2>{view === 'board' ? 'Board' : 'Operational log'}</h2>
            <p>{query ? `Filtering by “${query}”` : 'Showing all active tasks.'}</p>
          </Stack>
        </div>
      </PageBody>
    </Page>
  )
}

export const ListHeaderControls = {
  render: () => <ListHeaderControlsExample />,
  parameters: {
    bakinFixture: motionStoryFixture,
  },
  play: async ({ canvas }) => {
    const search = canvas.getByRole('searchbox', { name: 'Search tasks' })
    const board = canvas.getByRole('tab', { name: 'Board' })
    const action = canvas.getByRole('button', { name: 'New task' })
    const control = search.closest('[data-slot="search-input-control"]') as HTMLElement
    const page = search.closest('[data-archetype="page"]')
    const boardTop = board.getBoundingClientRect().top
    const actionTop = action.getBoundingClientRect().top

    await expect(control).toHaveAttribute('data-state', 'empty')
    await expect(page).toHaveAttribute('data-width', 'full')
    await expect(search).toHaveValue('')
    await expect(Math.abs(search.getBoundingClientRect().height - board.getBoundingClientRect().height)).toBeLessThan(1)
    await expect(Math.abs(search.getBoundingClientRect().height - action.getBoundingClientRect().height)).toBeLessThan(1)
    await expect(Math.abs(board.getBoundingClientRect().top - boardTop)).toBeLessThan(1)
    await expect(Math.abs(action.getBoundingClientRect().top - actionTop)).toBeLessThan(1)
  },
} satisfies Story

const tasks = [
  {
    id: 'task-01JZ9R8MT7TQ',
    title: 'Assemble launch cut for social channels',
    owner: 'Patch',
    target: 'asset:campaign/spring-hero-final-v18.webp',
    status: 'Running',
    tone: 'success' as const,
    updated: '42 sec ago',
  },
  {
    id: 'task-01JZ9S1B3KQ2',
    title: 'Reconcile partner usage and unreported spend',
    owner: 'Pixel',
    target: 'report:usage/2026-W29/provider-breakdown.csv',
    status: 'Needs attention',
    tone: 'attention' as const,
    updated: '8 min ago',
  },
  {
    id: 'task-01JZ9T4P6KE7',
    title: 'Review migration copy for external plugin builders',
    owner: 'Rolo',
    target: 'docs:extending/ui-migration-guide',
    status: 'Blocked',
    tone: 'danger' as const,
    updated: '1 hr ago',
  },
]

function ListIndexExample() {
  const [activeFilter, setActiveFilter] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matchesFilter = activeFilter === 'All' || task.status === activeFilter
    const haystack = `${task.title} ${task.owner} ${task.target}`.toLowerCase()
    return matchesFilter && haystack.includes(query.trim().toLowerCase())
  }), [activeFilter, query])
  const filtered = activeFilter !== 'All' || query !== ''
  const clear = () => { setActiveFilter('All'); setQuery('') }

  return (
    <Page className="bakin-archetype-story">
      <PageHeader
        eyebrow="Tasks / live operations"
        title="Coordinate active work"
        description="Keep owners, timing, and operational context visible. Search and filters belong in the URL, and the first control region stays borderless. Add a divider only when controls begin a genuinely separate page zone."
        actions={<><Button variant="outline">Export view</Button><Button>New task</Button></>}
      />

      <PageControls
        label="Task list controls"
        actions={filtered ? <Button variant="ghost" onClick={clear}>Clear all</Button> : undefined}
      >
        <div className="bakin-archetype-story__search">
          <Label htmlFor="task-index-search">Search tasks</Label>
          <Input
            id="task-index-search"
            type="search"
            value={query}
            placeholder="Title, owner, or target"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div className="bakin-archetype-story__filters" role="group" aria-label="Task status">
          {filters.map((filter) => (
            <Button
              key={filter}
              size="sm"
              variant={activeFilter === filter ? 'secondary' : 'outline'}
              aria-pressed={activeFilter === filter}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </Button>
          ))}
        </div>
      </PageControls>

      <PageBody
        label="Task results"
        state={visibleTasks.length === 0 ? (
          <SystemState
            kind="no-results"
            title="No tasks match this view"
            description="The current search and status filter exclude every active task."
            action={<Button variant="outline" onClick={clear}>Clear search and filters</Button>}
          />
        ) : undefined}
      >
        <div className="bakin-archetype-story__result-heading">
          <Stack gap="dense">
            <h2>{activeFilter === 'All' ? 'Active work' : activeFilter}</h2>
            <p>One content hierarchy; object boundaries appear only where the repeated task requires them.</p>
          </Stack>
          <Badge tone="neutral" variant="outline">{visibleTasks.length} shown</Badge>
        </div>
        <ul className="bakin-archetype-story__list" aria-label="Active tasks">
          {visibleTasks.map((task) => (
            <li key={task.id}>
              <div className="bakin-archetype-story__task-copy">
                <strong>{task.title}</strong>
                <code>{task.target}</code>
              </div>
              <div className="bakin-archetype-story__task-meta">
                <Badge tone={task.tone}>{task.status}</Badge>
                <span>{task.owner} · {task.updated}</span>
              </div>
              <Button variant="outline" size="sm" aria-label={`Open ${task.title}`}>Open</Button>
            </li>
          ))}
        </ul>
      </PageBody>
    </Page>
  )
}

export const ListIndex = {
  render: () => <ListIndexExample />,
  play: async ({ canvas, userEvent }) => {
    const filter = canvas.getByRole('button', { name: 'Needs attention' })
    await userEvent.click(filter)
    await expect(filter).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByRole('listitem')).toHaveTextContent('Reconcile partner usage')
    await expect(canvas.getByRole('region', { name: 'Task results' })).toHaveAttribute('data-content-state', 'ready')
    await userEvent.click(canvas.getByRole('button', { name: 'All' }))
  },
} satisfies Story

const paginatedRecords = Array.from({ length: 13 }, (_, index) => {
  const task = tasks[index % tasks.length]!
  return {
    ...task,
    id: `${task.id}-${index + 1}`,
    title: `${task.title} ${String(index + 1).padStart(2, '0')}`,
  }
})

function ListPaginationExample() {
  const pageSize = 5
  const [page, setPage] = useState(1)
  const [showAll, setShowAll] = useState(false)
  const visible = showAll
    ? paginatedRecords
    : paginatedRecords.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Page className="bakin-archetype-story">
      <PageHeader
        eyebrow="Memory / indexed records"
        title="Keep long result sets scannable"
        description="Paginate repeated content by default. Keep the page in routed URL state and reserve Show all for deliberate inspection."
        meta={<Badge tone="neutral" variant="outline">{visible.length} shown</Badge>}
      />
      <PageBody label="Indexed memory records">
        <ul className="bakin-archetype-story__list bakin-archetype-story__list--separated" aria-label="Memory records">
          {visible.map((record) => (
            <li key={record.id}>
              <div className="bakin-archetype-story__task-copy">
                <strong>{record.title}</strong>
                <span>{record.target}</span>
              </div>
              <div className="bakin-archetype-story__task-meta">
                <Badge tone="neutral" variant="solid">Durable</Badge>
                <span>{record.owner} · {record.updated}</span>
              </div>
              <Button variant="outline" size="sm" aria-label={`Open ${record.title}`}>Open</Button>
            </li>
          ))}
        </ul>
        <Pagination
          ariaLabel="Memory record pagination"
          page={page}
          pageSize={pageSize}
          showAll={showAll}
          total={paginatedRecords.length}
          onPageChange={setPage}
          onShowAllChange={(nextShowAll) => {
            setShowAll(nextShowAll)
            setPage(1)
          }}
        />
      </PageBody>
    </Page>
  )
}

export const ListPagination = {
  render: () => <ListPaginationExample />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('Showing 1–5 of 13')).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Memory records' }).children).toHaveLength(5)
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }))
    await expect(canvas.getByText('Showing 6–10 of 13')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Show all' }))
    await expect(canvas.getByText('Showing 1–13 of 13')).toBeVisible()
  },
} satisfies Story

export const ServerPagination = {
  render: () => (
    <Page className="bakin-archetype-story">
      <PageHeader
        eyebrow="Health / failure patterns"
        title="Page server-bounded evidence"
        description="Use the same paginator without Show all when the server only returns one bounded page. Never offer a control the current data contract cannot fulfill."
      />
      <PageBody label="Failure patterns">
        <ul className="bakin-archetype-story__list bakin-archetype-story__list--separated" aria-label="Failure patterns">
          {paginatedRecords.slice(5, 10).map((record) => (
            <li key={record.id}>
              <div className="bakin-archetype-story__task-copy">
                <strong>{record.title}</strong>
                <span>{record.target}</span>
              </div>
            </li>
          ))}
        </ul>
        <Pagination
          ariaLabel="Server result pagination"
          page={2}
          pageSize={5}
          total={13}
          onPageChange={() => undefined}
        />
      </PageBody>
    </Page>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Showing 6–10 of 13')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument()
  },
} satisfies Story

export const ListNoResults = {
  render: () => (
    <Page className="bakin-archetype-story">
      <PageHeader
        eyebrow="Tasks / live operations"
        title="Coordinate active work"
        description="Page identity and controls remain available when only the result region changes state."
        actions={<Button>New task</Button>}
      />
      <PageControls label="Task list controls">
        <div className="bakin-archetype-story__active-query"><span>Search</span><strong>archived partner invoice</strong></div>
        <Button variant="secondary" aria-pressed="true">Blocked</Button>
      </PageControls>
      <PageBody
        label="Task results"
        state={(
          <SystemState
            kind="no-results"
            scope="page"
            title="No tasks match this view"
            description="Clear the archived invoice search or broaden the current status filter."
            action={<Button variant="outline">Clear search and filters</Button>}
          />
        )}
      />
    </Page>
  ),
} satisfies Story

function DetailExample() {
  return (
    <Page className="bakin-archetype-story">
      <PageHeader
        navigation={(
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-bakin-pill"
            aria-label="Back to workflows"
            title="Back to workflows"
          >
            <ArrowLeft />
          </Button>
        )}
        eyebrow="Workflows / detail"
        title="Launch approval"
        description="Coordinates the final publishing decision without hiding ownership, schedule, or recent execution context."
        meta={<><code>workflow:launch-approval</code><Badge tone="success">Active</Badge></>}
        overflowActionsLabel="Workflow actions"
        overflowActions={(
          <>
            <DropdownMenuItem>Duplicate workflow</DropdownMenuItem>
            <DropdownMenuItem variant="danger"><Trash2 /> Delete</DropdownMenuItem>
          </>
        )}
        actions={<Button>Edit workflow</Button>}
      />

      <PageBody layout="aside" feedback={<Banner tone="info" title="Draft-safe editing" description="Changes are reviewed before they replace the active definition." />}>
        <Stack gap="section" className="bakin-archetype-story__detail-main">
          <Section spacing="compact" aria-labelledby="workflow-definition-heading">
            <Stack gap="dense">
              <h2 id="workflow-definition-heading">Definition</h2>
              <p className="bakin-archetype-story__section-description">The primary record remains content-first instead of becoming a stack of nested cards.</p>
            </Stack>
            <dl className="bakin-archetype-story__definition-list">
              <div><dt>Trigger</dt><dd>Campaign asset enters final review</dd></div>
              <div><dt>Decision owner</dt><dd>Marketing operations</dd></div>
              <div><dt>Success path</dt><dd>Publish approved variants to every active channel</dd></div>
              <div><dt>Failure path</dt><dd>Return the asset to its owner with reviewer context</dd></div>
            </dl>
          </Section>

          <Section spacing="compact" divider="top" aria-labelledby="workflow-activity-heading">
            <Stack gap="dense">
              <h2 id="workflow-activity-heading">Recent activity</h2>
              <p className="bakin-archetype-story__section-description">Operational detail can become denser inside its own repeated-content boundary.</p>
            </Stack>
            <ol className="bakin-archetype-story__activity">
              <li><span>Approval requested by Patch</span><time>8 minutes ago</time></li>
              <li><span>Final asset validation passed</span><time>12 minutes ago</time></li>
              <li><span>Social variants regenerated</span><time>18 minutes ago</time></li>
            </ol>
          </Section>
        </Stack>

        <PageAside label="Workflow context">
          <section aria-labelledby="workflow-context-heading">
            <h2 id="workflow-context-heading">Context</h2>
            <dl className="bakin-archetype-story__context-list">
              <div><dt>Owner</dt><dd>Marketing operations</dd></div>
              <div><dt>Schedule</dt><dd>Event driven</dd></div>
              <div><dt>Last run</dt><dd><code>run:01JZ9T4P6KE7</code></dd></div>
            </dl>
          </section>
          <section aria-labelledby="workflow-related-heading">
            <h2 id="workflow-related-heading">Related</h2>
            <Inline gap="dense"><Button variant="outline" size="sm">Open asset</Button><Button variant="ghost" size="sm">View run</Button></Inline>
          </section>
        </PageAside>
      </PageBody>
    </Page>
  )
}

export const Detail = {
  render: () => <DetailExample />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Launch approval' })).toBeVisible()
    await expect(canvas.getByRole('complementary', { name: 'Workflow context' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Workflow actions' })).toBeVisible()
    await expect(canvas.queryByRole('main')).not.toBeInTheDocument()
  },
} satisfies Story

export const ContainedDetailWorkspace = {
  render: () => (
    <Page
      scroll="contained"
      className="bakin-archetype-story bakin-archetype-story--contained"
      data-testid="contained-detail-page"
    >
      <PageHeader
        eyebrow="Messaging / plan"
        title="Spring menu launch"
        description="The page identity remains fixed while the named plan pane owns its long content."
      />
      <PageBody>
        {/* A genuinely scrolling pane must be keyboard-reachable (axe
            scrollable-region-focusable); the consumer owns that decision. */}
        <div
          role="region"
          aria-label="Plan sections"
          tabIndex={0}
          className="bakin-archetype-story__contained-scroll"
          data-testid="contained-detail-scroll"
        >
          {Array.from({ length: 14 }, (_, index) => (
            <section key={index}>
              <h2>Plan section {index + 1}</h2>
              <p>Long workspace content scrolls here without expanding the page canvas.</p>
            </section>
          ))}
        </div>
      </PageBody>
    </Page>
  ),
  play: async ({ canvas }) => {
    const page = canvas.getByTestId('contained-detail-page')
    const scrollRegion = canvas.getByTestId('contained-detail-scroll')

    await expect(page).toHaveAttribute('data-scroll', 'contained')
    await expect(scrollRegion.scrollHeight).toBeGreaterThan(scrollRegion.clientHeight)
  },
} satisfies Story

const mediaVersions = [
  { version: 'v4', state: 'Current', note: 'Final vertical crop', updated: '2 minutes ago' },
  { version: 'v3', state: 'Previous', note: 'Color and contrast pass', updated: '18 minutes ago' },
  { version: 'v2', state: 'Previous', note: 'Initial approved composition', updated: '1 hour ago' },
]

export const DetailMedia = {
  render: () => (
    <Page
      className="bakin-archetype-story"
      data-testid="media-detail-page"
    >
      <PageHeader
        measure="wide"
        navigation={(
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-bakin-pill"
            aria-label="Back to assets"
            title="Back to assets"
          >
            <ArrowLeft />
          </Button>
        )}
        eyebrow="Assets / detail"
        title="Gourmet seasoned popcorn with rosemary and parmesan"
        meta={<><code>asset:spring-campaign-hero</code><Badge tone="success">v4 · current</Badge></>}
        overflowActionsLabel="Asset actions"
        overflowActions={(
          <>
            <DropdownMenuItem>Add version</DropdownMenuItem>
            <DropdownMenuItem variant="danger"><Trash2 /> Delete</DropdownMenuItem>
          </>
        )}
        actions={<Button>Edit asset</Button>}
      />

      <PageBody layout="aside">
        <Stack gap="section" className="bakin-archetype-story__detail-main">
          <Section spacing="compact" aria-labelledby="media-preview-heading">
            <h2 id="media-preview-heading">Preview</h2>
            <div
              className="bakin-archetype-story__media-preview"
              role="img"
              aria-label="Abstract spring campaign preview"
            >
              <span>4:5 master</span>
            </div>
          </Section>
        </Stack>

        <PageAside label="Asset context">
          <section aria-labelledby="media-context-heading">
            <h2 id="media-context-heading">Asset context</h2>
            <dl className="bakin-archetype-story__context-list">
              <div><dt>Owner</dt><dd>Pixel</dd></div>
              <div><dt>Source</dt><dd>Generated</dd></div>
              <div><dt>Format</dt><dd>WebP · 1600 × 2000</dd></div>
            </dl>
            <div className="bakin-archetype-story__media-enrichment">
              <div className="bakin-archetype-story__media-enrichment-heading">
                <h3 id="media-enrichment-heading">
                  <Sparkles aria-hidden="true" /> Enrichment
                </h3>
                <Badge tone="success" variant="soft" size="xs">Done</Badge>
              </div>
              <p className="bakin-archetype-story__section-description">
                Product photography with a warm botanical backdrop and clear copy-safe space.
              </p>
              <Inline gap="dense">
                <Badge tone="neutral" variant="soft">campaign</Badge>
                <Badge tone="neutral" variant="soft">spring</Badge>
              </Inline>
            </div>
          </section>

          <section aria-labelledby="media-downloads-heading">
            <h2 id="media-downloads-heading">Downloads</h2>
            <a className="bakin-archetype-story__media-download" href="#download">
              <Download aria-hidden="true" />
              <span>spring-campaign-square.webp</span>
              <span>v4</span>
            </a>
          </section>

          <section aria-labelledby="media-history-heading">
            <h2 id="media-history-heading">Version history</h2>
            <p className="bakin-archetype-story__section-description">
              History follows the document scroll instead of creating a nested vertical scroller.
            </p>
            <ol className="bakin-archetype-story__media-history">
              {mediaVersions.map((version) => (
                <li key={version.version}>
                  <div>
                    <strong>{version.version}</strong>
                    <Badge
                      tone={version.state === 'Current' ? 'success' : 'neutral'}
                      variant="soft"
                      size="xs"
                    >
                      {version.state}
                    </Badge>
                  </div>
                  <span>{version.note}</span>
                  <time>{version.updated}</time>
                </li>
              ))}
            </ol>
          </section>
        </PageAside>
      </PageBody>
    </Page>
  ),
  play: async ({ canvas }) => {
    const page = canvas.getByTestId('media-detail-page')
    const aside = canvas.getByRole('complementary', { name: 'Asset context' })
    const title = canvas.getByRole('heading', {
      level: 1,
      name: 'Gourmet seasoned popcorn with rosemary and parmesan',
    })
    const back = canvas.getByRole('button', { name: 'Back to assets' })
    const actions = canvas.getByRole('group', { name: 'Page actions' })

    await expect(page).toHaveAttribute('data-width', 'full')
    await expect(title.closest('[data-slot="page-header"]')).toHaveAttribute('data-measure', 'wide')
    await expect(title).toBeVisible()
    await expect(title).toHaveClass(/max-w-none/)
    await expect(back).toHaveClass(/rounded-bakin-pill/)
    await expect(back).toHaveAttribute('data-size', 'icon-sm')
    await expect(back.textContent).toBe('')
    await expect(back.closest('[data-slot="page-header-context"]')).toContainElement(
      canvas.getByText('Assets / detail'),
    )
    await expect(Math.abs(back.getBoundingClientRect().left - title.getBoundingClientRect().left)).toBeLessThan(1)
    await expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(actions.getBoundingClientRect().left)
    await expect(aside).toContainElement(canvas.getByRole('heading', { level: 3, name: 'Enrichment' }))
    await expect(aside).toContainElement(canvas.getByRole('heading', { level: 2, name: 'Downloads' }))
    await expect(aside).toContainElement(canvas.getByRole('heading', { name: 'Version history' }))
  },
} satisfies Story

export const DetailUnavailable = {
  render: () => (
    <Page width="standard" className="bakin-archetype-story">
      <PageHeader
        navigation={(
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-bakin-pill"
            aria-label="Back to workflows"
            title="Back to workflows"
          >
            <ArrowLeft />
          </Button>
        )}
        eyebrow="Workflows / detail"
        title="Archived campaign approval"
        description="The page identity and navigation remain usable when policy restricts the record body."
      />
      <PageBody
        state={(
          <SystemState
            kind="permission-denied"
            scope="page"
            title="Workflow definition is restricted"
            description="Your workspace role can see this workflow's identity but cannot inspect its execution inputs."
            action={<Button variant="outline">Request access</Button>}
          />
        )}
      />
    </Page>
  ),
} satisfies Story
