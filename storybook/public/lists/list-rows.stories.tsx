import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import { ListRow, ListRowActions, ListRowGroup, ListRowLabels, ListRows, StatusBadge } from '@makinbakin/sdk/patterns'
import { Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'

import './list-rows.stories.css'

const meta = {
  title: 'Components/Lists/ListRows',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ListRows and ListRow provide the three sanctioned visual relationships for repeated content. Use bordered rows for interactive resources and nested details, separated rows for a dense continuous log, and plain rows only when surrounding hierarchy already makes each item unambiguous. Consumers own domain content and actions; the pattern owns semantics, spacing, and boundaries.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'dense-data', 'non-color'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface ListRowsCanonicalArgs {
  /** Row boundary treatment: bordered resources, separated log rows, or plain structure. */
  variant: 'bordered' | 'separated' | 'plain'
}

export const CanonicalUsage = {
  parameters: { layout: 'padded' },
  args: {
    variant: 'bordered',
  },
  // No meta `component` (ListRows + ListRow compose), so the knob declares itself.
  argTypes: {
    variant: { control: 'select', options: ['bordered', 'separated', 'plain'] },
  },
  render: (args: ListRowsCanonicalArgs) => (
    <ListRows aria-label="Recent activity" variant={args.variant}>
      <ListRow>Catalog refreshed</ListRow>
      <ListRow>Agent package synced</ListRow>
    </ListRows>
  ),
  play: async ({ canvas, args }) => {
    const list = canvas.getByRole('list', { name: 'Recent activity' })
    await expect(list).toBeVisible()
    await expect(list).toHaveAttribute('data-variant', args.variant)
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2)
  },
} satisfies StoryObj<ListRowsCanonicalArgs>

function ListPattern({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="bakin-lists-story__section" aria-labelledby={`list-${title.toLowerCase()}`}>
      <header>
        <h2 id={`list-${title.toLowerCase()}`}>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  )
}

function ListVarietiesExample() {
  return (
    <main className="bakin-lists-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-lists-story__intro">
            <p>Repeated content / row relationships</p>
            <h1>Choose one list boundary and keep it consistent</h1>
            <p>
              Boundaries communicate how records relate. Choose the lightest sanctioned
              treatment that still makes the list immediately understandable.
            </p>
          </header>

          <ListPattern
            title="Bordered"
            description="Default for interactive resources, settings, and expandable nested details. Every row is a complete object."
          >
            <ListRows aria-label="Bordered lesson rows">
              <ListRow className="bakin-lists-story__row">
                <span className="bakin-lists-story__identity">
                  <FileText aria-hidden="true" />
                  <span>
                    <strong>brand-color-grade</strong>
                    <small>Brand color grade · style, images</small>
                  </span>
                </span>
                <span className="bakin-lists-story__actions">
                  <StatusBadge tone="success">Active</StatusBadge>
                  <Button size="sm" variant="outline">Open</Button>
                </span>
              </ListRow>
              <ListRow className="bakin-lists-story__row">
                <span className="bakin-lists-story__identity">
                  <AlertTriangle aria-hidden="true" />
                  <span>
                    <strong>Health endpoint failure</strong>
                    <small>Endpoint not found (HTTP 404).</small>
                  </span>
                </span>
                <span className="bakin-lists-story__actions">
                  <StatusBadge tone="danger">Failed</StatusBadge>
                  <time dateTime="2026-07-26T21:38:03-06:00">9:38 PM</time>
                </span>
              </ListRow>
            </ListRows>
          </ListPattern>

          <ListPattern
            title="Separated"
            description="For dense logs and scan tables where rows form one continuous result set rather than separate objects."
          >
            <ListRows aria-label="Separated activity rows" variant="separated">
              <ListRow className="bakin-lists-story__row">
                <span className="bakin-lists-story__identity">
                  <CheckCircle2 aria-hidden="true" />
                  <span>
                    <strong>Catalog refreshed</strong>
                    <small>24 records indexed without errors</small>
                  </span>
                </span>
                <time dateTime="2026-07-26T21:36:00-06:00">9:36 PM</time>
              </ListRow>
              <ListRow className="bakin-lists-story__row">
                <span className="bakin-lists-story__identity">
                  <CheckCircle2 aria-hidden="true" />
                  <span>
                    <strong>Agent package synced</strong>
                    <small>Managed content matches the installed package</small>
                  </span>
                </span>
                <time dateTime="2026-07-26T21:31:00-06:00">9:31 PM</time>
              </ListRow>
            </ListRows>
          </ListPattern>

          <ListPattern
            title="Plain"
            description="For short supporting facts where a section heading already establishes the relationship. Do not use it for interactive records."
          >
            <ListRows aria-label="Plain supporting facts" variant="plain">
              <ListRow className="bakin-lists-story__fact">
                <span>Source</span>
                <strong>Runtime</strong>
              </ListRow>
              <ListRow className="bakin-lists-story__fact">
                <span>Current version</span>
                <strong>v2</strong>
              </ListRow>
            </ListRows>
          </ListPattern>
        </Stack>
      </PageShell>
    </main>
  )
}

export const ListVarieties = {
  render: () => <ListVarietiesExample />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'Bordered lesson rows' })).toHaveAttribute('data-variant', 'bordered')
    await expect(canvas.getByRole('list', { name: 'Separated activity rows' })).toHaveAttribute('data-variant', 'separated')
    await expect(canvas.getByRole('list', { name: 'Plain supporting facts' })).toHaveAttribute('data-variant', 'plain')
    await expect(canvas.getAllByRole('listitem')).toHaveLength(6)
  },
} satisfies Story

const groupedChats = [
  {
    group: 'Pinned',
    chats: [
      { title: 'Release checklist', preview: 'main-agent · 2 days ago' },
    ],
  },
  {
    group: 'Today',
    chats: [
      { title: 'Brand kit review', preview: 'pixel · 12 minutes ago' },
      { title: 'Search outage triage', preview: 'main-agent · 3 hours ago' },
    ],
  },
]

function GroupedExample() {
  return (
    <main className="bakin-lists-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-lists-story__intro">
            <p>Grouped rows</p>
            <h1>Each group is its own labelled list</h1>
            <p>
              Date- or section-grouped rows wrap one ListRows per group in a
              ListRowGroup. The heading names the nested list automatically, so
              assistive technology hears an accurate name and item count per
              group.
            </p>
          </header>

          <Stack gap="item" data-testid="grouped-rows">
            {groupedChats.map((section) => (
              <ListRowGroup key={section.group} label={section.group}>
                <ListRows variant="plain">
                  {section.chats.map((chat) => (
                    <ListRow key={chat.title} className="bakin-lists-story__row">
                      <span className="bakin-lists-story__identity">
                        <span>
                          <strong>{chat.title}</strong>
                          <small>{chat.preview}</small>
                        </span>
                      </span>
                      <Button size="sm" variant="ghost">Open</Button>
                    </ListRow>
                  ))}
                </ListRows>
              </ListRowGroup>
            ))}
          </Stack>
        </Stack>
      </PageShell>
    </main>
  )
}

export const Grouped = {
  render: () => <GroupedExample />,
  play: async ({ canvas }) => {
    const pinned = canvas.getByRole('list', { name: 'Pinned' })
    const today = canvas.getByRole('list', { name: 'Today' })
    await expect(pinned).toBeVisible()
    await expect(within(pinned).getAllByRole('listitem')).toHaveLength(1)
    await expect(within(today).getAllByRole('listitem')).toHaveLength(2)
    const group = pinned.closest('[data-slot=list-row-group]')
    await expect(group).toBeTruthy()
    const label = group!.querySelector('[data-slot=list-row-group-label]')
    await expect(label).toBeVisible()
    await expect(label!.textContent).toBe('Pinned')
    // The heading labels the list; it is not itself a list item.
    await expect(within(group as HTMLElement).getAllByRole('listitem')).toHaveLength(1)
  },
} satisfies Story

const routeRows = [
  { name: 'Subagent work', summary: 'Deep multi-step build and research tasks', status: 'Routed', tone: 'success' as const },
  { name: 'Triage', summary: 'Quick classification passes over incoming work', status: 'Inherit', tone: 'neutral' as const },
  { name: 'Relay', summary: 'Notification relays to the operator', status: 'Routed', tone: 'success' as const },
]

function ColumnsList({ label, testId }: { label: string; testId: string }) {
  return (
    <ListRows
      aria-label={label}
      data-testid={testId}
      variant="separated"
      columns="minmax(9rem,.7fr) minmax(0,1fr) minmax(6rem,.4fr)"
      columnsAt="2xl"
    >
      <ListRowLabels>
        <span>Work class</span>
        <span>Summary</span>
        <span>Status</span>
      </ListRowLabels>
      {routeRows.map((route) => (
        <ListRow key={route.name}>
          <span className="bakin-lists-story__cell">
            <strong>{route.name}</strong>
          </span>
          <span className="bakin-lists-story__cell bakin-lists-story__cell--muted">
            {route.summary}
          </span>
          <span className="bakin-lists-story__cell">
            <StatusBadge tone={route.tone}>{route.status}</StatusBadge>
          </span>
        </ListRow>
      ))}
    </ListRows>
  )
}

function ColumnsExample() {
  return (
    <main className="bakin-lists-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-lists-story__intro">
            <p>Columns</p>
            <h1>Rows share one grid template, then stack</h1>
            <p>
              The consumer passes a single grid-template track list. Every row
              aligns to it once the list container is wide enough; below the
              breakpoint each row stacks its cells vertically. Cells stay
              self-describing — columns are visual alignment, not table
              semantics.
            </p>
          </header>

          <ListPattern
            title="Aligned"
            description="At a wide container every row adopts the shared template and the label row appears."
          >
            <ColumnsList label="Dispatch routes" testId="columns-wide" />
          </ListPattern>

          <ListPattern
            title="Stacked"
            description="A narrow container stacks each row's cells; the label row disappears with the columns."
          >
            <div className="bakin-lists-story__narrow">
              <ColumnsList label="Dispatch routes (narrow)" testId="columns-narrow" />
            </div>
          </ListPattern>
        </Stack>
      </PageShell>
    </main>
  )
}

export const Columns = {
  render: () => <ColumnsExample />,
  play: async ({ canvas }) => {
    const wide = canvas.getByTestId('columns-wide')
    await expect(wide).toHaveAttribute('data-columns', '')
    const rows = Array.from(wide.querySelectorAll('[data-slot=list-row]'))
    await expect(rows).toHaveLength(3)
    const templates = rows.map((row) => getComputedStyle(row).gridTemplateColumns)
    // Three resolved tracks, identical across every row — the alignment contract.
    await expect(templates[0]!.split(' ')).toHaveLength(3)
    await expect(new Set(templates).size).toBe(1)
    const labels = wide.querySelector('[data-slot=list-row-labels]')
    await expect(labels).toHaveAttribute('aria-hidden', 'true')
    await expect(getComputedStyle(labels as Element).display).toBe('grid')

    const narrow = canvas.getByTestId('columns-narrow')
    const narrowRow = narrow.querySelector('[data-slot=list-row]')
    // Below the breakpoint the shared template is inactive: cells stack into
    // a single column (Chromium reports the one implicit track).
    await expect(getComputedStyle(narrowRow as Element).gridTemplateColumns.split(' ')).toHaveLength(1)
    await expect(getComputedStyle(narrow.querySelector('[data-slot=list-row-labels]') as Element).display).toBe('none')
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story


const openRow = fn()
const rowAction = fn()

export const InteractiveRows = {
  parameters: {
    docs: {
      description: {
        story:
          'Whole-row activation and selection are ListRow contracts: `interactive` emits one labeled overlay control (button, or `render` for links) with a real focus ring, and `selected` applies the canonical row tint. Never stretch a ghost Button across a row or hand-paint selection.',
      },
    },
  },
  render: () => (
    <PageShell width="content">
      <ListRows variant="bordered" aria-label="Recent chats">
        <ListRow
          interactive={{ label: 'Open Margo standup recap', onActivate: openRow }}
          className="flex items-center justify-between gap-bakin-3"
        >
          <span className="min-w-0">
            <span className="block font-bakin-typography-weight-semibold">Margo — standup recap</span>
            <span className="block text-bakin-text-muted">Wrapped 20 minutes ago</span>
          </span>
          <Button variant="ghost" size="sm" onClick={rowAction}>Pin</Button>
        </ListRow>
        <ListRow
          selected
          interactive={{ label: 'Open Pixel asset review', onActivate: openRow }}
          className="flex items-center justify-between gap-bakin-3"
        >
          <span className="min-w-0">
            <span className="block font-bakin-typography-weight-semibold">Pixel — asset review</span>
            <span className="block text-bakin-text-muted">Active now</span>
          </span>
        </ListRow>
      </ListRows>
    </PageShell>
  ),
  play: async ({ canvas }) => {
    openRow.mockClear()
    rowAction.mockClear()
    // The whole-row action is one real, focusable control with an accessible name.
    const overlay = canvas.getByRole('button', { name: 'Open Margo standup recap' })
    await userEvent.click(overlay)
    await expect(openRow).toHaveBeenCalledTimes(1)
    // Nested controls stay independent of the row action.
    await userEvent.click(canvas.getByRole('button', { name: 'Pin' }))
    await expect(rowAction).toHaveBeenCalledTimes(1)
    await expect(openRow).toHaveBeenCalledTimes(1)
    // Keyboard path: Enter on the overlay activates the row.
    overlay.focus()
    await userEvent.keyboard('{Enter}')
    await expect(openRow).toHaveBeenCalledTimes(2)
    // Selection is the row's contract, painted by the kit.
    const selectedRow = canvas.getByText('Pixel — asset review').closest('[data-slot="list-row"]') as HTMLElement
    await expect(selectedRow).toHaveAttribute('data-selected')
    await expect(getComputedStyle(selectedRow).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  },
} satisfies Story


const denseOpen = fn()
const densePin = fn()

export const DenseRows = {
  parameters: {
    docs: {
      description: {
        story:
          'size="sm" is the dense rail/feed rhythm — set once on ListRows, inherited by every row; never cancel row padding with className. The title/subtitle anatomy shown here is the canonical two-line recipe (semibold body title, muted meta subtitle, Stack-gapped). ListRowActions mirrors CardAction: reveal="hover" floats the cluster in on row hover or keyboard focus with the interactive-surface discipline handled by the kit.',
      },
    },
  },
  render: () => (
    <PageShell width="content">
      <ListRows size="sm" variant="bordered" aria-label="Chats">
        <ListRow
          interactive={{ label: 'Open chat: Margo — standup recap', onActivate: denseOpen }}
          className="flex items-center gap-bakin-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-bakin-typography-size-body font-bakin-typography-weight-semibold">Margo — standup recap</span>
            <span className="block truncate text-bakin-typography-size-meta text-bakin-text-muted">Wrapped 20 minutes ago</span>
          </span>
          <ListRowActions reveal="hover" aria-label="Chat actions">
            <Button variant="ghost" size="icon-xs" aria-label="Pin chat" onClick={densePin} />
          </ListRowActions>
        </ListRow>
        <ListRow
          interactive={{ label: 'Open chat: Pixel — asset review', onActivate: denseOpen }}
          className="flex items-center gap-bakin-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-bakin-typography-size-body font-bakin-typography-weight-semibold">Pixel — asset review</span>
            <span className="block truncate text-bakin-typography-size-meta text-bakin-text-muted">Active now</span>
          </span>
        </ListRow>
      </ListRows>
    </PageShell>
  ),
  play: async ({ canvas }) => {
    denseOpen.mockClear()
    densePin.mockClear()
    const list = canvas.getByRole('list', { name: 'Chats' })
    await expect(list).toHaveAttribute('data-size', 'sm')
    const row = canvas.getByText('Margo — standup recap').closest('[data-slot="list-row"]') as HTMLElement
    await expect(row).toHaveAttribute('data-size', 'sm')
    // Keyboard path: focusing the row (its overlay) reveals the cluster…
    const overlay = canvas.getByRole('button', { name: 'Open chat: Margo — standup recap' })
    overlay.focus()
    const pin = canvas.getByRole('button', { name: 'Pin chat' })
    const cluster = pin.closest('[data-slot="list-row-actions"]') as HTMLElement
    await expect(getComputedStyle(cluster).display).not.toBe('none')
    // …and the revealed action stays independent of the row action.
    await userEvent.click(pin)
    await expect(densePin).toHaveBeenCalledTimes(1)
    await expect(denseOpen).not.toHaveBeenCalled()
    await userEvent.click(overlay)
    await expect(denseOpen).toHaveBeenCalledTimes(1)
  },
} satisfies Story

export const LoadingPreview = {
  parameters: {
    docs: {
      description: {
        story:
          'The canonical list loading recipe: SystemState kind="loading" with a preview of row-shaped skeletons (circle + two fractional lines). Never hand-compose ad-hoc skeleton stacks with magic pixel sizes.',
      },
    },
  },
  render: () => (
    <PageShell width="content">
      <SystemState
        kind="loading"
        scope="section"
        title="Loading chats"
        description="Recent conversations will appear here."
        preview={(
          <div className="w-full">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex items-center gap-bakin-2 px-bakin-2 py-bakin-2">
                <Skeleton shape="circle" className="size-bakin-6 shrink-0" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-bakin-3 w-3/4" />
                  <Skeleton className="mt-bakin-1 h-bakin-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}
      />
    </PageShell>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading chats')).toBeVisible()
    // Row-shaped preview: three clusters of circle + two lines.
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]')
    await expect(skeletons.length).toBe(9)
  },
} satisfies Story
