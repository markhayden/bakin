import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { useQueryState } from '@makinbakin/sdk/navigation'
import { DataTable, StatusBadge, type DataTableColumn } from '@makinbakin/sdk/patterns'
import { Inline } from '@makinbakin/sdk/layout'
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text } from '@makinbakin/sdk/ui'
import { EntryVisual, entryStatusBadge } from './catalog-entry'
import { runtimeCompatible, type ExploreCatalogEntry } from '../types'

const SORT_ITEMS: Record<string, string> = {
  'name:asc': 'Name: A–Z', 'name:desc': 'Name: Z–A',
  'category:asc': 'Category: A–Z', 'category:desc': 'Category: Z–A',
  'status:asc': 'Status: A–Z', 'status:desc': 'Status: Z–A',
}

/** Lives in the page's filter region; table headers share its URL state. */
export function CatalogSortControl() {
  const [query, setQuery] = useQueryState('catalogSort', 'name:asc')
  const value = Object.hasOwn(SORT_ITEMS, query) ? query : 'name:asc'
  return (
    <Select items={SORT_ITEMS} value={value} onValueChange={next => { if (next && Object.hasOwn(SORT_ITEMS, next)) setQuery(next) }}>
      <SelectTrigger aria-label="Sort catalog"><SelectValue /></SelectTrigger>
      <SelectContent>{Object.entries(SORT_ITEMS).map(([key, title]) => <SelectItem key={key} value={key}>{title}</SelectItem>)}</SelectContent>
    </Select>
  )
}

export function CatalogTable({ entries, activeAdapter, onSelect, onInstall }: {
  entries: readonly ExploreCatalogEntry[]
  activeAdapter?: string
  onSelect: (entry: ExploreCatalogEntry) => void
  onInstall?: (entry: ExploreCatalogEntry) => void
}) {
  const [query, setQuery] = useQueryState('catalogSort', 'name:asc')
  const value = Object.hasOwn(SORT_ITEMS, query) ? query : 'name:asc'
  const [field, dir] = value.split(':') as ['name' | 'category' | 'status', 'asc' | 'desc']
  const rows = useMemo(() => [...entries].sort((a, b) => {
    const left = field === 'status' ? entryStatusBadge(a)?.label ?? 'Available' : a[field]
    const right = field === 'status' ? entryStatusBadge(b)?.label ?? 'Available' : b[field]
    const order = left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
    return dir === 'asc' ? order : -order
  }), [entries, field, dir])
  const columns: ReadonlyArray<DataTableColumn<ExploreCatalogEntry>> = [
    { key: 'name', header: 'Name', sortable: true, narrow: 'primary', headClassName: 'w-1/2', cellClassName: 'whitespace-normal', cell: entry => (
      <Inline wrap={false} align="start">
        <EntryVisual entry={entry} size="sm" />
        <div className="min-w-0">
          <Text weight="semibold" className="break-words">{entry.name}</Text>
          <Text as="p" size="meta" tone="muted" className="line-clamp-2 break-words">{entry.description}</Text>
        </div>
      </Inline>
    ) },
    { key: 'category', header: 'Category', sortable: true, narrow: 'meta', cellClassName: 'whitespace-nowrap', cell: entry => entry.category },
    { key: 'status', header: 'Status', sortable: true, narrow: 'meta', cellClassName: 'whitespace-nowrap', cell: entry => {
      const status = entryStatusBadge(entry)
      return status ? <StatusBadge tone={status.tone} variant={status.variant} icon={status.icon} size="xs">{status.label}</StatusBadge>
        : <Text size="meta" tone="muted">Available</Text>
    } },
    { key: 'version', header: 'Version', narrow: 'label', cellClassName: 'whitespace-nowrap', cell: entry => entry.installedVersion ? `v${entry.installedVersion}` : '—' },
    { key: 'runtime', header: 'Runtime', narrow: 'label', headClassName: 'w-1/8', cellClassName: 'whitespace-normal wrap-normal', cell: entry => runtimeCompatible(entry, activeAdapter)
      ? <Text size="meta" tone="muted">{entry.runtimes?.includes('*') || !entry.runtimes ? 'Any runtime' : entry.runtimes.join(', ')}</Text>
      : <Text size="meta" tone="muted">Not for {activeAdapter ?? 'this runtime'} — requires {(entry.runtimes ?? []).join(', ')}</Text> },
    { key: 'actions', header: 'Actions', hideLabel: true, narrow: 'trailing', align: 'end', cell: entry => (
      <Inline gap="dense" wrap={false} justify="end">
        <Button variant="ghost" size="xs" aria-label={`View ${entry.name} details`} onClick={() => onSelect(entry)}>Details</Button>
        {!entry.builtin && !entry.installed && onInstall && runtimeCompatible(entry, activeAdapter) ? (
          <Button size="xs" aria-label={`Install ${entry.name}`} onClick={() => onInstall(entry)}><Plus />Install</Button>
        ) : null}
      </Inline>
    ) },
  ]
  return <DataTable label="Catalog items" columns={columns} rows={rows} rowKey={entry => `${entry.kind}:${entry.id}`}
      rowProps={entry => ({ 'data-testid': `catalog-row-${entry.kind}-${entry.id}` })}
      collapseBelow="3xl" listVariant="separated" sort={{ field, dir }}
      onSortChange={key => setQuery(`${key}:${field === key && dir === 'asc' ? 'desc' : 'asc'}`)} />
}
