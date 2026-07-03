/**
 * ⌘K global search (spec D10 / req 4): one query across every registered
 * content type via /api/search, grouped by type, type-filter chips (req 6),
 * keyboard navigation, Enter deep-links. Debug mode shows the per-leg
 * ScoreOverlay badges (req 2). Engine down = the honest SearchUnavailable
 * state (D11) — never silently empty.
 *
 * Plugins contribute rendering through registerPlugin({ search:
 * { hitRenderers } }); unknown types fall back to a default renderer so
 * new tables appear in global search with zero UI work.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, FileQuestion } from 'lucide-react'
import { useSearch, useDebug, type SearchResult } from '@makinbakin/sdk/hooks'
import { SearchUnavailable, ScoreOverlay } from '@makinbakin/sdk/components'
import {
  getSearchHitRenderersSnapshot,
  subscribeSearchHitRenderers,
  type SearchHitDescriptor,
} from '@makinbakin/sdk'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { useSearchHotkey } from './use-search-hotkey'

const TABLE_PREFIX = 'bakin_'

function bareType(result: SearchResult): string {
  const table = result._table ?? result.table ?? ''
  return table.startsWith(TABLE_PREFIX) ? table.slice(TABLE_PREFIX.length) : table
}

function defaultDescriptor(result: SearchResult): SearchHitDescriptor {
  const fields = result.fields ?? {}
  const title =
    (typeof fields.title === 'string' && fields.title)
    || (typeof fields.description === 'string' && fields.description)
    || result.id
  return { title: String(title).slice(0, 120), subtitle: bareType(result), href: null, icon: 'file-question' }
}

export function GlobalSearchOverlay() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeTypes, setActiveTypes] = useState<string[]>([])
  const navigate = useNavigate()
  const debug = useDebug()

  const renderers = useSyncExternalStore(
    subscribeSearchHitRenderers,
    getSearchHitRenderersSnapshot,
    getSearchHitRenderersSnapshot,
  )

  const search = useSearch({
    limit: 30,
    types: activeTypes.length > 0 ? activeTypes : undefined,
  })

  const onOpen = useCallback(() => setOpen(true), [])
  useSearchHotkey(onOpen)

  const onQueryChange = (value: string) => {
    setQuery(value)
    search.search(value)
  }

  const close = () => {
    setOpen(false)
    setQuery('')
    setActiveTypes([])
    search.clear()
  }

  // Chip set: every type a plugin registered a renderer for, plus any type
  // present in the current results (so unknown tables are still filterable).
  const chipTypes = useMemo(() => {
    const types = new Set<string>(renderers.keys())
    for (const result of search.results) types.add(bareType(result))
    return Array.from(types).sort()
  }, [renderers, search.results])

  const grouped = useMemo(() => {
    const groups = new Map<string, SearchResult[]>()
    for (const result of search.results) {
      const type = bareType(result)
      const list = groups.get(type) ?? []
      list.push(result)
      groups.set(type, list)
    }
    return Array.from(groups.entries())
  }, [search.results])

  const toggleType = (type: string) => {
    setActiveTypes((prev) => {
      const next = prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
      // Re-run the active query under the new type restriction.
      if (query.trim()) setTimeout(() => search.search(query), 0)
      return next
    })
  }

  const onSelect = (descriptor: SearchHitDescriptor) => {
    if (!descriptor.href) return
    close()
    void navigate({ to: descriptor.href })
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => { if (!next) close(); else setOpen(true) }}
      // Takeover layout: ~80vw x 80vh centered, results fill the height.
      className="top-1/2 -translate-y-1/2 h-[80vh] w-[80vw] max-w-[80vw] sm:max-w-[80vw] flex flex-col"
    >
      {/* Results come pre-ranked from the engine — cmdk must not re-filter. */}
      <Command shouldFilter={false} className="flex h-full flex-col">
      <CommandInput
        placeholder="Search assets, tasks, memory, workflows…"
        value={query}
        onValueChange={onQueryChange}
      />
      {chipTypes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2" data-testid="global-search-chips">
          {chipTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              className={`rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors ${
                activeTypes.includes(type)
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              data-testid={`global-search-chip-${type}`}
            >
              {type}
            </button>
          ))}
        </div>
      )}
      <CommandList className="max-h-none flex-1 overflow-y-auto">
        {search.status === 'unavailable' && (
          <SearchUnavailable retry={search.retry} className="py-10" />
        )}
        {search.status === 'error' && (
          <div className="p-6 text-center text-sm text-destructive" data-testid="global-search-error">
            Search failed: {search.error}
          </div>
        )}
        {search.status === 'loading' && (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" data-testid="global-search-spinner" /> Searching…
          </div>
        )}
        {search.status === 'idle' && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Type to search everything — assets, tasks, memory, workflows.
          </div>
        )}
        {search.status === 'ok' && search.results.length === 0 && (
          <CommandEmpty>No results for “{query}”.</CommandEmpty>
        )}
        {search.status === 'ok' && grouped.map(([type, results]) => (
          <CommandGroup key={type} heading={type} data-testid={`global-search-group-${type}`}>
            {results.map((result) => {
              const renderer = renderers.get(type)
              const descriptor = renderer ? renderer(result) : defaultDescriptor(result)
              return (
                <CommandItem
                  key={`${type}:${result.id}`}
                  value={`${type}:${result.id}`}
                  onSelect={() => onSelect(descriptor)}
                  className="flex items-center gap-4 rounded-lg px-4 py-3"
                  data-testid={`global-search-hit-${result.id}`}
                >
                  {descriptor.thumbnailUrl ? (
                    <img src={descriptor.thumbnailUrl} alt="" className="size-16 shrink-0 rounded-md object-cover" />
                  ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted">
                      <FileQuestion className="size-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-medium">{descriptor.title}</div>
                    {descriptor.subtitle && (
                      <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{descriptor.subtitle}</div>
                    )}
                  </div>
                  {debug && (
                    <ScoreOverlay info={{ score: result.score, indexScores: result.indexScores }} />
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
