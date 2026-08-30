// @vitest-environment jsdom

import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DataTable, ListRow, type DataTableColumn } from '@makinbakin/sdk/patterns'
import '../../rtl-settle'

interface RunRow {
  id: string
  task: string
  owner: string
}

const ROWS: RunRow[] = [
  { id: 'r1', task: 'Publish launch announcement', owner: 'Margo' },
  { id: 'r2', task: 'Reconcile provider usage', owner: 'Pixel' },
]

const COLUMNS: ReadonlyArray<DataTableColumn<RunRow, 'task'>> = [
  { key: 'task', header: 'Task', sortable: true },
  { key: 'owner', header: 'Owner' },
  { key: 'actions', header: 'Actions', hideLabel: true, cell: () => <button type="button">Menu</button> },
]

describe('DataTable', () => {
  it('renders the container-query dual render: one table and one list sharing the label', () => {
    const { container } = render(
      <DataTable
        label="Dispatch runs"
        collapseBelow="2xl"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        onSortChange={() => {}}
      />,
    )

    const root = container.querySelector('[data-slot="data-table"]')
    expect(root?.className).toContain('@container/data-table')

    const tableRegion = container.querySelector('[data-slot="data-table-table"]')
    expect(tableRegion?.className).toBe('hidden @2xl/data-table:block')

    const table = screen.getByRole('table', { name: 'Dispatch runs' })
    expect(table.getAttribute('data-slot')).toBe('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)

    const list = screen.getByRole('list', { name: 'Dispatch runs' })
    expect(list.getAttribute('data-slot')).toBe('data-table-list')
    expect(list.getAttribute('data-variant')).toBe('separated')
    expect(list.className).toContain('@2xl/data-table:hidden')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('defaults to table-only, so comparable records stay aligned columns', () => {
    // The default is `none`: a table scrolls horizontally inside its own
    // container rather than restacking into label/value pairs. Collapsing is
    // opt-in for the tables whose rows genuinely read better stacked.
    const { container } = render(
      <DataTable label="Runs" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
    )
    expect(container.querySelector('[data-slot="data-table-table"]')?.className).toBe('block')
    expect(container.querySelector('[data-slot="data-table-list"]')).toBeNull()
  })

  it('collapses at the configured container breakpoint and supports table-only mode', () => {
    const { container, rerender } = render(
      <DataTable label="Runs" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} collapseBelow="3xl" />,
    )

    expect(container.querySelector('[data-slot="data-table-table"]')?.className)
      .toBe('hidden @3xl/data-table:block')

    rerender(
      <DataTable label="Runs" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} collapseBelow="none" />,
    )
    expect(container.querySelector('[data-slot="data-table-table"]')?.className).toBe('block')
    // `none` can never show the narrow render, so it is not rendered at
    // all — no duplicate interactive controls in the DOM or tab order.
    expect(container.querySelector('[data-slot="data-table-list"]')).toBeNull()
  })

  it('composes SortableHead for sortable columns and hides action headers accessibly', () => {
    const onSortChange = mock(() => {})
    render(
      <DataTable
        label="Dispatch runs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        sort={{ field: 'task', dir: 'asc' }}
        onSortChange={onSortChange}
      />,
    )

    const taskHeader = screen.getByRole('columnheader', { name: 'Task' })
    expect(taskHeader.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(within(taskHeader).getByRole('button', { name: 'Task' }))
    expect(onSortChange).toHaveBeenCalledWith('task')

    const ownerHeader = screen.getByRole('columnheader', { name: 'Owner' })
    expect(ownerHeader.getAttribute('aria-sort')).toBeNull()
    expect(within(ownerHeader).queryByRole('button')).toBeNull()

    const actionsHeader = screen.getByRole('columnheader', { name: 'Actions' })
    expect(actionsHeader.querySelector('.sr-only')?.textContent).toBe('Actions')
  })

  it('derives default cells from row records, honors custom cells, and merges rowProps', () => {
    const onRowClick = mock((_runId: string) => {})
    render(
      <DataTable
        label="Dispatch runs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        rowProps={(row) => ({
          'data-run-id': row.id,
          className: 'cursor-pointer',
          onClick: () => onRowClick(row.id),
        })}
      />,
    )

    const table = screen.getByRole('table', { name: 'Dispatch runs' })
    const bodyRows = within(table).getAllByRole('row').slice(1)
    expect(bodyRows[0]?.textContent).toContain('Publish launch announcement')
    expect(bodyRows[0]?.textContent).toContain('Margo')
    expect(bodyRows[0]?.getAttribute('data-run-id')).toBe('r1')
    expect(bodyRows[0]?.className).toContain('cursor-pointer')
    expect(within(bodyRows[0] as HTMLElement).getByRole('button', { name: 'Menu' })).toBeDefined()

    fireEvent.click(bodyRows[1] as HTMLElement)
    expect(onRowClick).toHaveBeenCalledWith('r2')
  })

  it('supports full custom rows in both renders and forwards table props', () => {
    render(
      <DataTable
        label="Dispatch runs"
        collapseBelow="2xl"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        listVariant="bordered"
        tableProps={{ 'data-testid': 'run-table', className: 'min-w-max' }}
        renderTableRow={(row) => (
          <tr key={row.id} data-custom-row={row.id}>
            <td colSpan={3}>{row.task}</td>
          </tr>
        )}
        renderRow={(row) => <ListRow key={row.id} data-custom-list-row={row.id}>{row.task}</ListRow>}
      />,
    )

    const table = screen.getByTestId('run-table')
    expect(table.className).toContain('min-w-max')
    expect(table.querySelectorAll('[data-custom-row]')).toHaveLength(2)

    const list = screen.getByRole('list', { name: 'Dispatch runs' })
    expect(list.getAttribute('data-variant')).toBe('bordered')
    expect(list.querySelectorAll('[data-custom-list-row]')).toHaveLength(2)
  })

  it('composes the shared Pagination below the active render', () => {
    const onPageChange = mock(() => {})
    render(
      <DataTable
        label="Dispatch runs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        pagination={{
          page: 1,
          pageSize: 2,
          total: 8,
          ariaLabel: 'Run pagination',
          onPageChange,
        }}
      />,
    )

    expect(screen.getByRole('navigation', { name: 'Run pagination' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('stacks a primary/label-value mapping as the default narrow row', () => {
    render(
      <DataTable label="Dispatch runs" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} collapseBelow="2xl" />,
    )

    const list = screen.getByRole('list', { name: 'Dispatch runs' })
    const firstRow = within(list).getAllByRole('listitem')[0] as HTMLElement
    // First column is the primary line; the rest render as label/value pairs.
    expect(firstRow.textContent).toContain('Publish launch announcement')
    expect(firstRow.textContent).toContain('Owner')
    expect(firstRow.textContent).toContain('Margo')
    // Hidden-label action columns keep their content but not a label.
    expect(within(firstRow).getByRole('button', { name: 'Menu' })).toBeDefined()
    expect(firstRow.textContent).not.toContain('Actions')
  })

  it('composes the narrow card when any column declares a narrow role', () => {
    interface TaskRow {
      id: string
      title: string
      agent: string
      status: string
      created?: string
    }
    const columns: ReadonlyArray<DataTableColumn<TaskRow>> = [
      { key: 'id', header: 'ID', narrow: 'hidden' },
      { key: 'title', header: 'Title', narrow: 'primary' },
      {
        key: 'agent',
        header: 'Agent',
        narrow: 'leading',
        cell: (row) => `${row.agent} (full)`,
        narrowCell: (row) => row.agent,
      },
      { key: 'status', header: 'Status', narrow: 'trailing' },
      { key: 'created', header: 'Created', narrow: 'meta', narrowCell: (row) => row.created ?? null },
    ]
    const rows: TaskRow[] = [
      { id: 't1', title: 'Publish launch announcement', agent: 'Margo', status: 'Done', created: '09:41' },
      { id: 't2', title: 'Reconcile provider usage', agent: 'Pixel', status: 'Running' },
    ]
    render(
      <DataTable label="Task log" columns={columns} rows={rows} rowKey={(row) => row.id} collapseBelow="2xl" />,
    )

    const list = screen.getByRole('list', { name: 'Task log' })
    const [first, second] = within(list).getAllByRole('listitem') as HTMLElement[]

    // Primary + leading (compact narrowCell) + trailing + meta compose one card.
    expect(first!.textContent).toContain('Publish launch announcement')
    expect(first!.textContent).toContain('Margo')
    expect(first!.textContent).not.toContain('Margo (full)')
    expect(first!.textContent).toContain('Done')
    expect(first!.textContent).toContain('09:41')
    // Hidden columns leave the narrow render entirely.
    expect(first!.textContent).not.toContain('t1')
    // Dropped visible labels stay accessible as sr-only column names.
    expect(first!.textContent).toContain('Agent')
    expect(first!.textContent).toContain('Status')
    // Null narrowCell content drops the meta item, label and all.
    expect(second!.textContent).not.toContain('Created')

    // The wide table render still uses the full cell for every column.
    const tableRegion = document.querySelector('[data-slot="data-table-table"]') as HTMLElement
    expect(within(tableRegion).getAllByText('Margo (full)').length).toBe(1)
  })
})

describe('DataTable uncontrolled sort', () => {
  interface Run { id: string; task: string; durationMs: number | null; finishedAt: string | null }
  const runs: Run[] = [
    { id: 'a', task: 'Publish v10', durationMs: 420, finishedAt: '2026-08-29T10:00:00Z' },
    { id: 'b', task: 'Publish v9', durationMs: null, finishedAt: null },
    { id: 'c', task: 'archive drafts', durationMs: 30, finishedAt: '2026-08-30T10:00:00Z' },
  ]
  const columns: ReadonlyArray<DataTableColumn<Run, 'task' | 'duration' | 'finished'>> = [
    { key: 'task', header: 'Task', sortable: true, sortValue: (row) => row.task },
    { key: 'duration', header: 'Duration', sortable: true, sortValue: (row) => row.durationMs, cell: (row) => row.durationMs ?? '—' },
    { key: 'finished', header: 'Finished', sortable: true, sortValue: (row) => (row.finishedAt ? new Date(row.finishedAt) : null), cell: (row) => row.finishedAt ?? '—' },
    { key: 'actions', header: 'Actions', hideLabel: true, cell: () => <button type="button">Menu</button> },
  ]
  const firstCells = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent)

  it('sorts itself when no controlled sort is supplied, starting ascending on a new column', () => {
    render(<DataTable label="Runs" columns={columns} rows={runs} rowKey={(row) => row.id} />)
    expect(firstCells()).toEqual(['Publish v10', 'Publish v9', 'archive drafts'])
    const task = screen.getByRole('columnheader', { name: 'Task' })
    fireEvent.click(within(task).getByRole('button', { name: 'Task' }))
    // Locale-aware and numeric: "v9" before "v10", case-insensitive.
    expect(task.getAttribute('aria-sort')).toBe('ascending')
    expect(firstCells()).toEqual(['archive drafts', 'Publish v9', 'Publish v10'])
    fireEvent.click(within(task).getByRole('button', { name: 'Task' }))
    expect(task.getAttribute('aria-sort')).toBe('descending')
    expect(firstCells()).toEqual(['Publish v10', 'Publish v9', 'archive drafts'])
  })

  it('keeps missing values last in both directions and honours defaultSort', () => {
    render(<DataTable label="Runs" columns={columns} rows={runs} rowKey={(row) => row.id} defaultSort={{ field: 'duration', dir: 'desc' }} />)
    expect(firstCells()).toEqual(['Publish v10', 'archive drafts', 'Publish v9'])
    const duration = screen.getByRole('columnheader', { name: 'Duration' })
    fireEvent.click(within(duration).getByRole('button', { name: 'Duration' }))
    expect(duration.getAttribute('aria-sort')).toBe('ascending')
    expect(firstCells()).toEqual(['archive drafts', 'Publish v10', 'Publish v9'])
    const finished = screen.getByRole('columnheader', { name: 'Finished' })
    fireEvent.click(within(finished).getByRole('button', { name: 'Finished' }))
    expect(firstCells()).toEqual(['Publish v10', 'archive drafts', 'Publish v9'])
  })

  it('never renders a sort affordance on a column without a value to sort by', () => {
    render(<DataTable label="Runs" columns={columns} rows={runs} rowKey={(row) => row.id} />)
    const actions = screen.getByRole('columnheader', { name: 'Actions' })
    expect(within(actions).queryByRole('button')).toBeNull()
  })

  it('defers to the consumer when sort is controlled', () => {
    const onSortChange = mock(() => {})
    render(<DataTable label="Runs" columns={columns} rows={runs} rowKey={(row) => row.id} sort={{ field: 'task', dir: 'desc' }} onSortChange={onSortChange} />)
    // Controlled: rows stay in the order given; the header only reports.
    expect(firstCells()).toEqual(['Publish v10', 'Publish v9', 'archive drafts'])
    fireEvent.click(within(screen.getByRole('columnheader', { name: 'Task' })).getByRole('button', { name: 'Task' }))
    expect(onSortChange).toHaveBeenCalledWith('task')
  })
})
