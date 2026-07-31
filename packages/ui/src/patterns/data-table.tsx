'use client'

import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../utils'
import { ListRow, ListRows, type ListRowsVariant } from './list-rows'
import { Pagination, type PaginationProps } from './pagination'
import { SortableHead, type SortDir } from './sortable-head'

export type DataTableAlign = 'start' | 'center' | 'end'

interface DataTableColumnBase<Row> {
  /** Column header content. Kept for screen readers when `hideLabel` is set. */
  header: ReactNode
  /** Visually hide the header text (action/menu columns) while keeping it accessible. */
  hideLabel?: boolean
  align?: DataTableAlign
  headClassName?: string
  cellClassName?: string
  /**
   * Cell content for one row. Defaults to `row[key]` when the row is a plain
   * record whose property renders directly.
   */
  cell?: (row: Row) => ReactNode
}

/**
 * Sortable columns must key into the consumer's sort-field union so
 * `onSortChange` only ever receives fields the consumer can sort by.
 */
export type DataTableColumn<Row, F extends string = string> =
  | (DataTableColumnBase<Row> & { key: F; sortable: true })
  | (DataTableColumnBase<Row> & { key: string; sortable?: false })

export interface DataTableSort<F extends string = string> {
  field: F
  dir: SortDir
}

/** Container width below which the narrow list render replaces the table. */
export type DataTableCollapse = 'xl' | '2xl' | '3xl' | 'none'

/** Element props plus `data-*` attributes, which object literals cannot otherwise carry. */
type WithDataAttributes<Props> = Props & { [dataAttribute: `data-${string}`]: string | undefined }

export interface DataTableProps<Row, F extends string = string> {
  columns: ReadonlyArray<DataTableColumn<Row, F>>
  rows: readonly Row[]
  /** Stable identity per row — keys both renders. */
  rowKey: (row: Row) => string
  /** Accessible name shared by the table and the narrow list render. */
  label: string
  /** Controlled sort state; compose with `onSortChange`. The consumer owns ordering `rows`. */
  sort?: DataTableSort<F>
  /** Receives the clicked column key; the consumer owns toggle/direction logic. */
  onSortChange?: (field: F) => void
  /**
   * Composes the shared Pagination below whichever render is active. The
   * consumer owns the visible slice of `rows`, exactly as with `Pagination`.
   */
  pagination?: PaginationProps
  /**
   * Container-query breakpoint (measured on the DataTable itself, never the
   * viewport) below which the list render replaces the table.
   * Defaults to `'2xl'` (42rem). `'none'` keeps the table at every width.
   */
  collapseBelow?: DataTableCollapse
  /** Row relationship of the narrow list render. */
  listVariant?: ListRowsVariant
  /**
   * Full custom `<TableRow>`/`<tr>` per row for the wide render — the escape
   * for rows with their own interactivity (row-level menus, keyboard
   * handlers). Defaults to cells derived from `columns`.
   */
  renderTableRow?: (row: Row) => ReactNode
  /** Extra props merged onto each default `<tr>` (row click handlers, data attributes). */
  rowProps?: (row: Row) => WithDataAttributes<ComponentPropsWithoutRef<'tr'>>
  /**
   * Full custom `<ListRow>`/`<li>` per row for the narrow render. Defaults to
   * a stacked primary/label-value mapping derived from `columns`.
   */
  renderRow?: (row: Row) => ReactNode
  /** Extra props for the `<table>` element (test ids, min-width classes). */
  tableProps?: WithDataAttributes<ComponentPropsWithoutRef<'table'>>
  className?: string
}

const TABLE_MODE_CLASS: Record<DataTableCollapse, string> = {
  xl: 'hidden @xl/data-table:block',
  '2xl': 'hidden @2xl/data-table:block',
  '3xl': 'hidden @3xl/data-table:block',
  none: 'block',
}

const LIST_MODE_CLASS: Record<DataTableCollapse, string> = {
  xl: '@xl/data-table:hidden',
  '2xl': '@2xl/data-table:hidden',
  '3xl': '@3xl/data-table:hidden',
  none: 'hidden',
}

const ALIGN_CLASS: Record<DataTableAlign, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
}

function cellContent<Row, F extends string>(column: DataTableColumn<Row, F>, row: Row): ReactNode {
  if (column.cell) return column.cell(row)
  return (row as Record<string, ReactNode>)[column.key]
}

/**
 * Configured table over the public `Table*` primitives with sorting
 * (SortableHead), pagination (Pagination), and a built-in responsive dual
 * render: wide containers show a real `<table>`, narrow containers show the
 * same rows as `ListRows`. The switch is container-query driven — a DataTable
 * inside a drawer collapses independently of the viewport.
 *
 * The consumer owns data concerns end to end: row order (controlled sort),
 * the visible slice (pagination passthrough), and loading/empty/error states
 * around the component. `Table*` stays public as the D9-gated escape hatch
 * for tables this configuration cannot express.
 */
export function DataTable<Row, F extends string = string>({
  columns,
  rows,
  rowKey,
  label,
  sort,
  onSortChange,
  pagination,
  collapseBelow = '2xl',
  listVariant = 'separated',
  renderTableRow,
  rowProps,
  renderRow,
  tableProps,
  className,
}: DataTableProps<Row, F>) {
  const { className: tableClassName, ...tableRest } = tableProps ?? {}

  return (
    <div data-slot="data-table" className={cn('@container/data-table min-w-0', className)}>
      <div data-slot="data-table-table" className={TABLE_MODE_CLASS[collapseBelow]}>
        <div data-slot="table-container" className="relative w-full overflow-x-auto">
          <table
            aria-label={label}
            data-slot="table"
            className={cn('w-full caption-bottom text-bakin-typography-size-body', tableClassName)}
            {...tableRest}
          >
            <thead
              data-slot="table-header"
              className="[&_tr]:border-b [&_tr]:border-bakin-border-subtle"
            >
              <tr data-slot="table-row">
                {columns.map((column) => {
                  const alignClass = ALIGN_CLASS[column.align ?? 'start']
                  if (column.sortable && onSortChange) {
                    return (
                      <SortableHead
                        key={column.key}
                        field={column.key}
                        current={sort?.field ?? ('' as F)}
                        dir={sort?.dir ?? 'desc'}
                        onSort={onSortChange}
                        className={cn(alignClass, column.headClassName)}
                      >
                        {column.header}
                      </SortableHead>
                    )
                  }
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      data-slot="table-head"
                      className={cn(
                        'h-bakin-10 whitespace-nowrap px-bakin-2 align-middle text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-semibold text-bakin-text-muted',
                        alignClass,
                        column.headClassName,
                      )}
                    >
                      {column.hideLabel ? <span className="sr-only">{column.header}</span> : column.header}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody data-slot="table-body" className="[&_tr:last-child]:border-0">
              {rows.map((row) => {
                if (renderTableRow) return renderTableRow(row)
                const extra = rowProps?.(row)
                return (
                  <tr
                    key={rowKey(row)}
                    data-slot="table-row"
                    {...extra}
                    className={cn(
                      'border-b border-bakin-border-subtle transition-colors hover:bg-bakin-surface-default',
                      extra?.className,
                    )}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        data-slot="table-cell"
                        className={cn(
                          'whitespace-nowrap p-bakin-2 align-middle',
                          ALIGN_CLASS[column.align ?? 'start'],
                          column.cellClassName,
                        )}
                      >
                        {cellContent(column, row)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ListRows
        aria-label={label}
        variant={listVariant}
        data-slot="data-table-list"
        className={LIST_MODE_CLASS[collapseBelow]}
      >
        {rows.map((row) => {
          if (renderRow) return renderRow(row)
          const [primary, ...rest] = columns
          return (
            <ListRow key={rowKey(row)}>
              <div className="grid min-w-0 gap-bakin-1">
                {primary ? (
                  <span className="min-w-0 break-words font-bakin-typography-weight-semibold text-bakin-text-primary">
                    {cellContent(primary, row)}
                  </span>
                ) : null}
                {rest.map((column) => (
                  <span
                    key={column.key}
                    className="flex min-w-0 flex-wrap items-baseline gap-x-bakin-2 text-[length:var(--bakin-typography-size-meta)]"
                  >
                    {!column.hideLabel ? (
                      <span className="text-bakin-text-muted">{column.header}</span>
                    ) : null}
                    <span className="min-w-0 break-words text-bakin-text-primary">
                      {cellContent(column, row)}
                    </span>
                  </span>
                ))}
              </div>
            </ListRow>
          )
        })}
      </ListRows>

      {pagination ? <Pagination {...pagination} /> : null}
    </div>
  )
}
