'use client'

import { useQueryState } from '@makinbakin/sdk/navigation'
import { Inline } from '@makinbakin/sdk/layout'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text } from '@makinbakin/sdk/ui'
import type { DataTableColumn, DataTableSort } from '@makinbakin/sdk/patterns'

/** Health inventories share one ordering for headings and narrow-view controls. */
export function useHealthTableSort<Row>(rows: readonly Row[], columns: ReadonlyArray<DataTableColumn<Row>>, queryKey: string, defaultField: string) {
  const [query, setQuery] = useQueryState(queryKey, `${defaultField}:asc`)
  const items = Object.fromEntries(columns.filter(column => column.sortable).flatMap(column => [
    [`${column.key}:asc`, `${column.header}: ascending`],
    [`${column.key}:desc`, `${column.header}: descending`],
  ]))
  const value = Object.hasOwn(items, query) ? query : `${defaultField}:asc`
  const [field, dir] = value.split(':') as [string, 'asc' | 'desc']
  const sort: DataTableSort = { field, dir }
  const accessor = columns.find(column => column.key === field)?.sortValue
  const sorted = accessor ? [...rows].sort((left, right) => {
    const a = accessor(left), b = accessor(right)
    if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1
    const compared = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
    return dir === 'asc' ? compared : -compared
  }) : rows
  return {
    rows: sorted, sort, items, value,
    onValueChange: (next: string | null) => { if (next && Object.hasOwn(items, next)) setQuery(next) },
    onSortChange: (nextField: string) => setQuery(`${nextField}:${field === nextField && dir === 'asc' ? 'desc' : 'asc'}`),
  }
}

export function HealthTableSort({ label, items, value, onValueChange }: {
  label: string
  items: Record<string, string>
  value: string
  onValueChange: (value: string | null) => void
}) {
  return <Inline gap="dense">
    <Text size="meta" tone="muted">Sort</Text>
    <Select items={items} value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{Object.entries(items).map(([key, title]) => <SelectItem key={key} value={key}>{title}</SelectItem>)}</SelectContent>
    </Select>
  </Inline>
}
