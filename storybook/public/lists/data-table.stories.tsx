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

export const CanonicalUsage = {
  parameters: { layout: 'padded' },
  render: () => (
    <DataTable
      label="Recent runs"
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
    const table = canvas.getByRole('table', { name: 'Recent runs' })
    await expect(table).toBeVisible()
    await expect(canvas.getAllByRole('columnheader')).toHaveLength(3)
    await expect(canvas.getAllByRole('row')).toHaveLength(3)
  },
} satisfies Story

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
