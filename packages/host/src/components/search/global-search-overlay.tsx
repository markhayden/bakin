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
import {
  Loader2, FileQuestion, Image as ImageIcon, FileText, Music, Video, File as FileIcon,
  CheckSquare, Brain, Users, GitBranch, Calendar, LayoutGrid, List as ListIcon,
  type LucideIcon,
} from 'lucide-react'
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

/** Renderer `icon` names → components (renderers are data-only; the host
 *  owns actual icon rendering). Unknown names fall back per group. */
const HIT_ICONS: Record<string, LucideIcon> = {
  'image': ImageIcon,
  'file-text': FileText,
  'music': Music,
  'video': Video,
  'file': FileIcon,
  'check-square': CheckSquare,
  'brain': Brain,
  'users': Users,
  'git-branch': GitBranch,
  'calendar': Calendar,
}

type ViewMode = 'card' | 'list'
const VIEW_KEY = 'bakin-global-search-view'
function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'card'
  } catch {
    return 'card'
  }
}

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

  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(() => new Set())
  const switchView = (mode: ViewMode) => {
    setViewMode(mode)
    try { localStorage.setItem(VIEW_KEY, mode) } catch { /* private mode */ }
  }

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
        <div className="ml-auto flex items-center gap-0.5 rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => switchView('card')}
            className={`rounded p-1 ${viewMode === 'card' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            title="Card view"
            data-testid="global-search-view-card"
          >
            <LayoutGrid className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => switchView('list')}
            className={`rounded p-1 ${viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            title="List view"
            data-testid="global-search-view-list"
          >
            <ListIcon className="size-3.5" />
          </button>
        </div>
      </div>
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
            <div className={viewMode === 'card' ? 'grid grid-cols-2 gap-3 p-1 md:grid-cols-3 xl:grid-cols-4' : undefined}>
              {results.map((result) => {
                const renderer = renderers.get(type)
                const descriptor = renderer ? renderer(result) : defaultDescriptor(result)
                const thumbSrc = descriptor.thumbnailUrl && !brokenThumbs.has(descriptor.thumbnailUrl)
                  ? descriptor.thumbnailUrl
                  : undefined
                const Icon = (descriptor.icon && HIT_ICONS[descriptor.icon]) || FileQuestion
                const media = (sizeClass: string, iconClass: string) => thumbSrc ? (
                  <img
                    src={thumbSrc}
                    alt=""
                    className={`${sizeClass} rounded-md object-cover`}
                    onError={() => setBrokenThumbs((prev) => new Set(prev).add(descriptor.thumbnailUrl!))}
                  />
                ) : (
                  <div className={`flex ${sizeClass} items-center justify-center rounded-md bg-muted`}>
                    <Icon className={`${iconClass} text-muted-foreground`} />
                  </div>
                )
                return viewMode === 'card' ? (
                  <CommandItem
                    key={`${type}:${result.id}`}
                    value={`${type}:${result.id}`}
                    onSelect={() => onSelect(descriptor)}
                    className="flex flex-col items-stretch gap-2 rounded-xl border p-3"
                    data-testid={`global-search-hit-${result.id}`}
                  >
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt=""
                        className="h-36 w-full rounded-lg object-cover"
                        onError={() => setBrokenThumbs((prev) => new Set(prev).add(descriptor.thumbnailUrl!))}
                      />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center rounded-lg bg-muted">
                        <Icon className="size-10 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-sm font-medium">{descriptor.title}</div>
                      {descriptor.subtitle && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{descriptor.subtitle}</div>
                      )}
                      {descriptor.meta && (
                        <div className="mt-1 truncate text-[11px] text-muted-foreground/70">{descriptor.meta}</div>
                      )}
                    </div>
                    {debug && (
                      <ScoreOverlay info={{ score: result.score, indexScores: result.indexScores }} />
                    )}
                  </CommandItem>
                ) : (
                  <CommandItem
                    key={`${type}:${result.id}`}
                    value={`${type}:${result.id}`}
                    onSelect={() => onSelect(descriptor)}
                    className="flex items-center gap-4 rounded-lg px-4 py-3"
                    data-testid={`global-search-hit-${result.id}`}
                  >
                    {media('size-16 shrink-0', 'size-6')}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-medium">{descriptor.title}</div>
                      {descriptor.subtitle && (
                        <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{descriptor.subtitle}</div>
                      )}
                      {descriptor.meta && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground/70">{descriptor.meta}</div>
                      )}
                    </div>
                    {debug && (
                      <ScoreOverlay info={{ score: result.score, indexScores: result.indexScores }} />
                    )}
                  </CommandItem>
                )
              })}
            </div>
          </CommandGroup>
        ))}
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
