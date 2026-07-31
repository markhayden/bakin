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
    expect(screen.getByRole('list', { name: 'Runs', hidden: true }).className).toContain('hidden')
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
      <DataTable label="Dispatch runs" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
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
})
