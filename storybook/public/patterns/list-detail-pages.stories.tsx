import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'
import { expect } from 'storybook/test'

import { Inline, Section, Stack } from '@makinbakin/sdk/layout'
import {
  DetailPage,
  DetailPageAside,
  DetailPageBody,
  DetailPageMain,
  ListPage,
  ListPageContent,
  ListPageControls,
  PageHeader,
  SearchInput,
  SegmentedControl,
} from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, Input, Label, SystemState } from '@makinbakin/sdk/ui'
import { DEFAULT_STORY_FIXTURE } from '../../fixtures'

import './page-archetypes.stories.css'

const meta = {
  title: 'Patterns/List and detail pages',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ListPage and DetailPage codify page identity, action placement, responsive flow, named control/content regions, state replacement, and scroll ownership. Consumers retain domain data and the existing SDK routing/query-state contract.',
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
    <ListPage className="bakin-archetype-story" width="full">
      <PageHeader
        title="Tasks"
        controlsLabel="Task search and view"
        controls={(
          <>
            <SearchInput
              align="end"
              label="Search tasks"
              value={query}
              onValueChange={setQuery}
              placeholder="Search tasks…"
            />
            <SegmentedControl
              ariaLabel="Task view"
              value={view}
              onValueChange={setView}
              options={[{ value: 'board', label: 'Board' }, { value: 'log', label: 'Log' }]}
            />
          </>
        )}
        actions={<Button>New task</Button>}
      />
      <ListPageContent label="Task results">
        <div className="bakin-archetype-story__result-heading">
          <Stack gap="dense">
            <h2>{view === 'board' ? 'Board' : 'Operational log'}</h2>
            <p>{query ? `Filtering by “${query}”` : 'Showing all active tasks.'}</p>
          </Stack>
        </div>
      </ListPageContent>
    </ListPage>
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
    const boardTop = board.getBoundingClientRect().top
    const actionTop = action.getBoundingClientRect().top

    await expect(control).toHaveAttribute('data-state', 'empty')
    await expect(search).toHaveValue('')
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
    <ListPage className="bakin-archetype-story">
      <PageHeader
        eyebrow="Tasks / live operations"
        title="Coordinate active work"
        description="Keep owners, timing, and operational context visible. Search and filters belong in the URL when this recipe is used in a routed page."
        actions={<><Button variant="outline">Export view</Button><Button>New task</Button></>}
      />

      <ListPageControls
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
      </ListPageControls>

      <ListPageContent
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
      </ListPageContent>
    </ListPage>
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

export const ListNoResults = {
  render: () => (
    <ListPage className="bakin-archetype-story">
      <PageHeader
        eyebrow="Tasks / live operations"
        title="Coordinate active work"
        description="Page identity and controls remain available when only the result region changes state."
        actions={<Button>New task</Button>}
      />
      <ListPageControls label="Task list controls">
        <div className="bakin-archetype-story__active-query"><span>Search</span><strong>archived partner invoice</strong></div>
        <Button variant="secondary" aria-pressed="true">Blocked</Button>
      </ListPageControls>
      <ListPageContent
        label="Task results"
        state={(
          <SystemState
            kind="no-results"
            title="No tasks match this view"
            description="Clear the archived invoice search or broaden the current status filter."
            action={<Button variant="outline">Clear search and filters</Button>}
          />
        )}
      />
    </ListPage>
  ),
} satisfies Story

function DetailExample() {
  return (
    <DetailPage className="bakin-archetype-story">
      <PageHeader
        navigation={<Button variant="ghost" size="sm">← Back to workflows</Button>}
        eyebrow="Workflows / detail"
        title="Launch approval"
        description="Coordinates the final publishing decision without hiding ownership, schedule, or recent execution context."
        meta={<><code>workflow:launch-approval</code><Badge tone="success">Active</Badge></>}
        actions={<><Button variant="outline">Duplicate</Button><Button>Edit workflow</Button></>}
      />

      <DetailPageBody layout="aside" feedback={<Banner tone="info" title="Draft-safe editing" description="Changes are reviewed before they replace the active definition." />}>
        <DetailPageMain>
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
        </DetailPageMain>

        <DetailPageAside label="Workflow context">
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
        </DetailPageAside>
      </DetailPageBody>
    </DetailPage>
  )
}

export const Detail = {
  render: () => <DetailExample />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Launch approval' })).toBeVisible()
    await expect(canvas.getByRole('complementary', { name: 'Workflow context' })).toBeVisible()
    await expect(canvas.queryByRole('main')).not.toBeInTheDocument()
  },
} satisfies Story

export const DetailUnavailable = {
  render: () => (
    <DetailPage width="content" className="bakin-archetype-story">
      <PageHeader
        navigation={<Button variant="ghost" size="sm">← Back to workflows</Button>}
        eyebrow="Workflows / detail"
        title="Archived campaign approval"
        description="The page identity and navigation remain usable when policy restricts the record body."
      />
      <DetailPageBody
        state={(
          <SystemState
            kind="permission-denied"
            title="Workflow definition is restricted"
            description="Your workspace role can see this workflow's identity but cannot inspect its execution inputs."
            action={<Button variant="outline">Request access</Button>}
          />
        )}
      />
    </DetailPage>
  ),
} satisfies Story
