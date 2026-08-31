import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import {
  DataTable,
  FacetFilter,
  SearchInput,
  type DataTableColumn,
  type DataTableSort,
} from '@makinbakin/sdk/patterns'
import { Badge } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Recipes/Filterable table page',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'End-to-end assembly of the query-controls-over-table kit on one list page: SearchInput narrows by debounced text, FacetFilter narrows by status, and DataTable renders the visible slice with sortable heads and the composed Pagination. The consumer owns every piece of list state — raw and debounced query, selected facets, whole-list sort, and the page — and derives the slice in that order (filter → sort → slice), resetting to page 1 whenever the query or facets change so no filter ever lands on an empty page. Sorting is controlled (`sort`/`onSortChange` with a consumer-owned toggle) because a paginated table only ever sees the visible slice — the uncontrolled `sortValue` mode is for unpaged collections. Composes DataTable, FacetFilter, and SearchInput from `@makinbakin/sdk/patterns` exactly as product list pages do; the kit owns presentation, semantics, and the aria-sort contract.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'interaction', 'debounced-search', 'facet-filter', 'sort', 'pagination'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface TaskRow {
  id: string
  title: string
  status: 'active' | 'paused' | 'done'
  owner: string
  updatedDays: number
}

const TASKS: readonly TaskRow[] = [
  { id: 't1', title: 'Assemble launch brief', status: 'active', owner: 'Maya', updatedDays: 1 },
  { id: 't2', title: 'Audit spend rollups', status: 'paused', owner: 'Patch', updatedDays: 9 },
  { id: 't3', title: 'Brief partner outreach', status: 'done', owner: 'Maya', updatedDays: 12 },
  { id: 't4', title: 'Calibrate burn heuristics', status: 'active', owner: 'Sol', updatedDays: 3 },
  { id: 't5', title: 'Draft migration copy', status: 'active', owner: 'Patch', updatedDays: 6 },
  { id: 't6', title: 'Groom asset backlog', status: 'paused', owner: 'Sol', updatedDays: 2 },
  { id: 't7', title: 'Index workspace files', status: 'done', owner: 'Maya', updatedDays: 20 },
  { id: 't8', title: 'Publish launch notes', status: 'active', owner: 'Sol', updatedDays: 0 },
  { id: 't9', title: 'Reconcile usage deltas', status: 'paused', owner: 'Maya', updatedDays: 4 },
  { id: 't10', title: 'Retire stale schedules', status: 'done', owner: 'Patch', updatedDays: 15 },
  { id: 't11', title: 'Sweep orphaned turns', status: 'active', owner: 'Patch', updatedDays: 7 },
  { id: 't12', title: 'Verify brand kit', status: 'active', owner: 'Maya', updatedDays: 5 },
]

const STATUS_TONE = { active: 'success', paused: 'attention', done: 'neutral' } as const

type SortField = 'title' | 'updated'
const PAGE_SIZE = 8

function FilterableTablePageExample() {
  const [rawQuery, setRawQuery] = useState('')
  const [query, setQuery] = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [sort, setSort] = useState<DataTableSort<SortField>>({ field: 'title', dir: 'asc' })
  const [page, setPage] = useState(1)

  // The consumer owns the debounce: the field stays immediate, the list waits.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), 120)
    return () => clearTimeout(timer)
  }, [rawQuery])

  // Filter → sort → slice; any narrowing lands back on page 1.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return TASKS.filter((task) =>
      (needle === '' || task.title.toLowerCase().includes(needle))
      && (statuses.length === 0 || statuses.includes(task.status)))
  }, [query, statuses])

  const sorted = useMemo(() => {
    const direction = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((left, right) => direction * (sort.field === 'title'
      ? left.title.localeCompare(right.title)
      : left.updatedDays - right.updatedDays))
  }, [filtered, sort])

  const safePage = Math.min(page, Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)))
  const visible = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const columns: ReadonlyArray<DataTableColumn<TaskRow, SortField>> = [
    { key: 'title', header: 'Task', sortable: true, narrow: 'primary' },
    {
      key: 'status',
      header: 'Status',
      narrow: 'label',
      cell: (row) => <Badge tone={STATUS_TONE[row.status]} size="xs">{row.status}</Badge>,
    },
    { key: 'owner', header: 'Owner', narrow: 'meta' },
    {
      key: 'updated',
      header: 'Updated',
      sortable: true,
      align: 'end',
      narrow: 'trailing',
      cell: (row) => (row.updatedDays === 0 ? 'today' : `${row.updatedDays}d ago`),
    },
  ]

  return (
    <StoryStage
      eyebrow="Recipe"
      title="Filterable table page"
      description="One list page assembles the query kit: debounced search and a status facet narrow a consumer-owned list, sortable heads reorder the whole result, and pagination slices what the table shows."
    >
      <StorySection
        title="Tasks"
        description="The page owns query, facet, sort, and page state; the kit owns presentation and the aria-sort contract."
      >
        <Stack gap="dense">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--bakin-layout-space-2)', alignItems: 'center' }}>
            <SearchInput
              label="Search tasks"
              value={rawQuery}
              onValueChange={(value) => {
                setRawQuery(value)
                setPage(1)
              }}
              align="start"
            />
            <FacetFilter
              label="Status"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'paused', label: 'Paused' },
                { value: 'done', label: 'Done' },
              ]}
              selected={statuses}
              onChange={(next) => {
                setStatuses(next)
                setPage(1)
              }}
            />
          </div>
          <DataTable
            label="Tasks"
            columns={columns}
            rows={visible}
            rowKey={(row) => row.id}
            sort={sort}
            onSortChange={(field) => {
              setSort((current) => (current.field === field
                ? { field, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                : { field, dir: 'asc' }))
              setPage(1)
            }}
            pagination={{
              page: safePage,
              pageSize: PAGE_SIZE,
              total: sorted.length,
              ariaLabel: 'Task pages',
              onPageChange: setPage,
            }}
          />
        </Stack>
      </StorySection>
    </StoryStage>
  )
}

export const FilterableTable = {
  render: () => <FilterableTablePageExample />,
  play: async ({ canvas, userEvent }) => {
    const page = within(document.body)

    // Idle: full list, alphabetical, first page of 8.
    const table = canvas.getByRole('table', { name: 'Tasks' })
    await expect(canvas.getByText('Showing 1–8 of 12')).toBeVisible()
    await expect(within(table).getByRole('columnheader', { name: /Task/ })).toHaveAttribute('aria-sort', 'ascending')
    const firstCell = () => within(table).getAllByRole('row')[1]!.textContent ?? ''
    await expect(firstCell()).toContain('Assemble launch brief')

    // Sorting reorders the WHOLE result, not just the visible slice.
    await userEvent.click(within(table).getByRole('button', { name: 'Updated' }))
    await waitFor(() => expect(within(table).getByRole('columnheader', { name: /Updated/ })).toHaveAttribute('aria-sort', 'ascending'))
    await waitFor(() => expect(firstCell()).toContain('Publish launch notes'))

    // Pagination moves through the sorted result.
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }))
    await expect(canvas.getByText('Showing 9–12 of 12')).toBeVisible()
    await expect(within(table).getByText('Index workspace files')).toBeVisible()

    // A debounced query narrows the list and lands back on page 1 —
    // always await the debounced result, never assert right after typing.
    await userEvent.type(canvas.getByLabelText('Search tasks'), 'brief')
    // Two matches fit on one page, so Pagination honestly disappears — the
    // rows themselves are the evidence.
    await waitFor(() => expect(within(table).queryByText('Sweep orphaned turns')).toBeNull())
    await expect(within(table).getByText('Assemble launch brief')).toBeVisible()
    await expect(within(table).getByText('Brief partner outreach')).toBeVisible()
    await expect(canvas.queryByText(/Showing/)).toBeNull()

    // The status facet narrows further; the consumer owns the selection.
    await userEvent.click(canvas.getByRole('button', { name: 'Status, 0 selected' }))
    await userEvent.click(await page.findByRole('option', { name: /Done/ }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(table).queryByText('Assemble launch brief')).toBeNull())
    await expect(within(table).getByText('Brief partner outreach')).toBeVisible()

    // Clearing both restores the full collection.
    await userEvent.clear(canvas.getByLabelText('Search tasks'))
    await userEvent.click(canvas.getByRole('button', { name: 'Status, 1 selected' }))
    await userEvent.click(await page.findByRole('option', { name: /Done/ }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(canvas.getByText('Showing 1–8 of 12')).toBeVisible())
  },
} satisfies Story
