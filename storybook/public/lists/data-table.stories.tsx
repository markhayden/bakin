import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import {
  DataTable,
  StatusBadge,
  type DataTableColumn,
  type DataTableSort,
  type StatusTone,
} from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Lists/DataTable',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'DataTable is the sanctioned table type: columns/rows configuration over the public Table semantics, controlled sorting via SortableHead, Pagination passthrough, and a built-in responsive dual render — wide containers show a real table, narrow containers show the same rows as ListRows. The switch is container-query driven, so a DataTable in a drawer collapses independently of the viewport. Consumers own row order, the visible slice, and surrounding loading/empty/error states. The Table* primitives stay public only as the reviewed escape hatch for tables this configuration cannot express.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'dense-data', 'non-color'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface DataTableCanonicalArgs {
  /** Container breakpoint below which the table renders its rows as ListRows. */
  collapseBelow: 'xl' | '2xl' | '3xl' | 'none'
  /** ListRows presentation used by the collapsed narrow render. */
  listVariant: 'bordered' | 'separated' | 'plain'
}

export const CanonicalUsage = {
  parameters: { layout: 'padded' },
  args: {
    collapseBelow: '2xl',
    listVariant: 'separated',
  },
  argTypes: {
    // DataTable is generic, so docgen inference is weak; declare the two
    // presentation controls explicitly.
    collapseBelow: {
      control: 'select',
      options: ['xl', '2xl', '3xl', 'none'],
      description: 'Container width below which the dual render switches from table to ListRows.',
    },
    listVariant: {
      control: 'select',
      options: ['bordered', 'separated', 'plain'],
      description: 'ListRows variant for the collapsed narrow render.',
    },
  },
  render: (args: DataTableCanonicalArgs) => (
    <DataTable
      label="Recent runs"
      collapseBelow={args.collapseBelow}
      listVariant={args.listVariant}
      columns={[
        { key: 'task', header: 'Task' },
        { key: 'agent', header: 'Agent' },
        { key: 'status', header: 'Status' },
      ]}
      rows={[
        { id: 'run-1', task: 'Publish launch announcement', agent: 'Margo', status: 'Done' },
        { id: 'run-2', task: 'Refresh curated catalog', agent: 'Patch', status: 'Running' },
      ]}
      rowKey={(row) => row.id}
    />
  ),
  play: async ({ canvas }) => {
    // Every collapseBelow option keeps the table render active at the
    // desktop runner width; narrow behavior is covered by the dual-render story.
    const table = canvas.getByRole('table', { name: 'Recent runs' })
    await expect(table).toBeVisible()
    await expect(canvas.getAllByRole('columnheader')).toHaveLength(3)
    await expect(canvas.getAllByRole('row')).toHaveLength(3)
  },
} satisfies StoryObj<DataTableCanonicalArgs>

interface RunRow {
  id: string
  task: string
  owner: string
  status: 'Done' | 'Running' | 'Failed'
  updated: string
}

const RUN_TONES: Record<RunRow['status'], StatusTone> = {
  Done: 'success',
  Running: 'accent',
  Failed: 'danger',
}

const RUNS: RunRow[] = [
  { id: 'r1', task: 'Publish launch announcement', owner: 'Margo', status: 'Done', updated: '09:41' },
  { id: 'r2', task: 'Refresh curated catalog and verify every remote source still resolves', owner: 'Patch', status: 'Running', updated: '09:12' },
  { id: 'r3', task: 'Reconcile provider usage', owner: 'Pixel', status: 'Failed', updated: '08:56' },
  { id: 'r4', task: 'Archive stale drafts', owner: 'Margo', status: 'Done', updated: '08:47' },
  { id: 'r5', task: 'Sync agent packages', owner: 'Rolo', status: 'Done', updated: '08:20' },
  { id: 'r6', task: 'Rotate brand references', owner: 'Patch', status: 'Done', updated: '07:58' },
  { id: 'r7', task: 'Verify workflow fallback actions', owner: 'Rolo', status: 'Running', updated: '07:31' },
  { id: 'r8', task: 'Summarize overnight incidents', owner: 'Pixel', status: 'Done', updated: '07:02' },
]

type RunSortField = 'task' | 'owner' | 'updated'

const RUN_COLUMNS: ReadonlyArray<DataTableColumn<RunRow, RunSortField>> = [
  { key: 'task', header: 'Task', sortable: true },
  { key: 'owner', header: 'Owner', sortable: true },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <StatusBadge tone={RUN_TONES[row.status]}>{row.status}</StatusBadge>,
  },
  { key: 'updated', header: 'Updated', sortable: true, align: 'end' },
]

const PAGE_SIZE = 3

function DualRenderExample() {
  const [sort, setSort] = useState<DataTableSort<RunSortField>>({ field: 'updated', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(() => [...RUNS].sort((a, b) => {
    const compared = a[sort.field].localeCompare(b[sort.field])
    return sort.dir === 'asc' ? compared : -compared
  }), [sort])

  const visible = showAll ? sorted : sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <DataTable
      label="Dispatch runs"
      columns={RUN_COLUMNS}
      rows={visible}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={(field) => {
        setSort((previous) => previous.field === field
          ? { field, dir: previous.dir === 'asc' ? 'desc' : 'asc' }
          : { field, dir: 'asc' })
        setPage(1)
      }}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total: sorted.length,
        showAll,
        ariaLabel: 'Dispatch run pagination',
        onPageChange: setPage,
        onShowAllChange: (nextShowAll) => {
          setShowAll(nextShowAll)
          setPage(1)
        },
      }}
    />
  )
}

interface NarrowRunRow {
  id: string
  task: string
  owner: string
  status: 'Done' | 'Running' | 'Failed'
  updated: string
  duration: string
}

const NARROW_RUNS: NarrowRunRow[] = [
  { id: 'n1', task: 'Publish launch announcement', owner: 'Margo', status: 'Done', updated: '09:41', duration: '4m 12s' },
  { id: 'n2', task: 'Refresh curated catalog and verify every remote source still resolves', owner: 'Patch', status: 'Running', updated: '09:12', duration: '' },
  { id: 'n3', task: 'Reconcile provider usage', owner: 'Pixel', status: 'Failed', updated: '08:56', duration: '18s' },
]

const NARROW_COLUMNS: ReadonlyArray<DataTableColumn<NarrowRunRow>> = [
  { key: 'id', header: 'Run', narrow: 'meta', cell: (row) => row.id },
  { key: 'task', header: 'Task', narrow: 'primary' },
  {
    key: 'owner',
    header: 'Owner',
    narrow: 'leading',
    // The wide table names the owner; the narrow leading slot compacts to
    // initials the way an avatar column would.
    narrowCell: (row) => (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          inlineSize: '2rem',
          blockSize: '2rem',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'var(--bakin-color-surface-elevated)',
          color: 'var(--bakin-color-text-primary)',
          fontSize: 'var(--bakin-typography-size-meta)',
          fontWeight: 600,
        }}
      >
        {row.owner.slice(0, 2).toUpperCase()}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    narrow: 'trailing',
    cell: (row) => <StatusBadge tone={RUN_TONES[row.status]} size="xs">{row.status}</StatusBadge>,
  },
  { key: 'updated', header: 'Updated', narrow: 'meta' },
  { key: 'duration', header: 'Duration', narrow: 'meta', narrowCell: (row) => row.duration || null },
]

export const NarrowRoles = {
  parameters: {
    docs: {
      description: {
        story: 'Declaring a `narrow` role on any column replaces the flat label/value fallback with the composed narrow card: `leading` beside the text stack, `primary` bold with `trailing` right-aligned on the same line, `meta` columns folded into one muted dot-separated line hugging the primary (status hugs, content breathes), `label` keeping the label/value line, `hidden` dropped. `narrowCell` supplies a compact representation for the narrow render only; returning null drops that item. Dropped visible labels remain accessible as sr-only column names. `renderRow` stays the escape hatch for genuinely bespoke rows.',
      },
    },
  },
  render: () => (
    <StoryStage
      eyebrow="Lists / tables"
      title="Narrow roles compose the mobile card"
      description="The same columns that shape the wide table declare what they become when the container collapses — one consistent mobile row across every list."
    >
      <StorySection title="Collapsed run log (22rem container)">
        <div data-testid="narrow-stage" style={{ inlineSize: '22rem', maxInlineSize: '100%' }}>
          <DataTable
            label="Narrow run log"
            columns={NARROW_COLUMNS}
            rows={NARROW_RUNS}
            rowKey={(row) => row.id}
          />
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Narrow run log' })
    await expect(list).toBeVisible()
    const [first, second] = within(list).getAllByRole('listitem')

    // Primary, trailing chip, and the joined meta line share one card.
    await expect(first!).toHaveTextContent('Publish launch announcement')
    await expect(first!).toHaveTextContent('Done')
    await expect(first!).toHaveTextContent('09:41')
    await expect(first!).toHaveTextContent('4m 12s')
    // sr-only column names keep dropped labels accessible.
    await expect(first!).toHaveTextContent('Owner')
    // Empty narrowCell content drops its meta item, label included.
    await expect(second!).not.toHaveTextContent('Duration')
  },
} satisfies Story

export const SortedPagedDualRender = {
  render: () => (
    <StoryStage
      eyebrow="Lists / tables"
      title="One table, both widths"
      description="Sorting stays on the native column header, pagination composes below, and the narrow render replaces the table when the container — not the viewport — gets tight."
    >
      <StorySection title="Dispatch runs">
        <div data-testid="data-table-stage" style={{ inlineSize: 'min(100%, 52rem)' }}>
          <DualRenderExample />
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const stage = canvasElement.querySelector('[data-testid="data-table-stage"]') as HTMLElement
    const tableRegion = canvasElement.querySelector('[data-slot="data-table-table"]') as HTMLElement
    const listRegion = canvasElement.querySelector('[data-slot="data-table-list"]') as HTMLElement

    // At a narrow VIEWPORT (mobile visual project) the stage container is
    // already tight and the list render is active from the start — the
    // table-only steps below only apply when the table render is live.
    const tableActive = getComputedStyle(tableRegion).display !== 'none'
    if (tableActive) {
      await expect(tableRegion).toBeVisible()
      await expect(listRegion).not.toBeVisible()

      // Controlled sorting through SortableHead: aria-sort moves with the consumer state.
      const taskHeader = canvas.getByRole('columnheader', { name: 'Task' })
      await userEvent.click(within(taskHeader).getByRole('button', { name: 'Task' }))
      await expect(taskHeader).toHaveAttribute('aria-sort', 'ascending')
      const rows = within(tableRegion).getAllByRole('row')
      await expect(rows[1]).toHaveTextContent('Archive stale drafts')
    } else {
      await expect(listRegion).toBeVisible()
      await expect(within(listRegion).getAllByRole('listitem')).toHaveLength(3)
    }

    // Pagination passthrough renders once for BOTH renders: same terminal
    // state at every viewport.
    await expect(canvas.getByText(/Showing 1–3 of 8/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }))
    await expect(canvas.getByText(/Showing 4–6 of 8/)).toBeVisible()

    // Narrow CONTAINER (viewport untouched): ListRows replaces the table.
    stage.style.inlineSize = '20rem'
    await waitFor(async () => {
      await expect(listRegion).toBeVisible()
      await expect(tableRegion).not.toBeVisible()
    })
    await expect(within(listRegion).getAllByRole('listitem')).toHaveLength(3)

    // Back to the natural container width: the wide render returns wherever
    // the viewport allows a wide container at all.
    stage.style.inlineSize = ''
    if (tableActive) {
      await waitFor(async () => {
        await expect(tableRegion).toBeVisible()
        await expect(listRegion).not.toBeVisible()
      })
    }
  },
} satisfies Story
