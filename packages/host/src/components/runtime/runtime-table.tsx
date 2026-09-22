import { useQueryState } from '@makinbakin/sdk/navigation'
import { DataTable, type DataTableColumn } from '@makinbakin/sdk/patterns'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@makinbakin/sdk/ui'

/** Runtime inventories keep sorting available when headings collapse to rows. */
export function RuntimeTable<Row>({ label, queryKey, columns, rows, rowKey }: {
  label: string
  queryKey: string
  columns: ReadonlyArray<DataTableColumn<Row>>
  rows: readonly Row[]
  rowKey: (row: Row) => string
}) {
  const sortable = columns.filter(column => column.sortable && column.sortValue)
  const fallback = `${sortable[0]?.key}:asc`
  const [query, setQuery] = useQueryState(queryKey, fallback)
  const items = Object.fromEntries(sortable.flatMap(column => [
    [`${column.key}:asc`, `${column.header}: ascending`],
    [`${column.key}:desc`, `${column.header}: descending`],
  ]))
  const value = Object.hasOwn(items, query) ? query : fallback
  const [field, dir] = value.split(':') as [string, 'asc' | 'desc']
  const accessor = sortable.find(column => column.key === field)?.sortValue
  const ordered = accessor ? [...rows].sort((a, b) => {
    const left = accessor(a), right = accessor(b)
    if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1
    const compared = typeof left === 'number' && typeof right === 'number' ? left - right
      : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
    return dir === 'asc' ? compared : -compared
  }) : rows
  return <div className="grid min-w-0 gap-bakin-3">
    {sortable.length > 0 && <Select items={items} value={value} onValueChange={next => { if (next && Object.hasOwn(items, next)) setQuery(next) }}>
      <SelectTrigger aria-label={`Sort ${label.toLowerCase()}`}><SelectValue /></SelectTrigger>
      <SelectContent>{Object.entries(items).map(([key, title]) => <SelectItem key={key} value={key}>{title}</SelectItem>)}</SelectContent>
    </Select>}
    <DataTable label={label} columns={columns} rows={ordered} rowKey={rowKey}
      collapseBelow="3xl" listVariant="separated" sort={{ field, dir }}
      onSortChange={key => setQuery(`${key}:${field === key && dir === 'asc' ? 'desc' : 'asc'}`)} />
  </div>
}
