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
  Loader2, Image as ImageIcon, FileText, Music, Video, Map as MapIcon, Database,
  Package, CheckSquare, Brain, Users, GitBranch, Calendar, GraduationCap,
  LayoutGrid, List as ListIcon,
  type LucideIcon,
} from 'lucide-react'
import { useSearch, useDebug, type SearchResult } from '@makinbakin/sdk/hooks'
import { SearchUnavailable, ScoreOverlay } from '@makinbakin/sdk/components'
import { type SearchHitDescriptor } from '@makinbakin/sdk'
import {
  getSearchHitRenderersSnapshot,
  requestAllPlugins,
  subscribeSearchHitRenderers,
} from '@makinbakin/sdk/internal'
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

/** Renderer `icon` names → icon + tint. The asset types mirror the assets
 *  page's TYPE_ICONS/TYPE_COLORS exactly so global search reads the same;
 *  anything unknown gets the neutral Package — never a question mark. */
const HIT_ICONS: Record<string, { Icon: LucideIcon; tint: string }> = {
  'file-text': { Icon: FileText, tint: 'text-blue-400' },
  'image': { Icon: ImageIcon, tint: 'text-emerald-400' },
  'video': { Icon: Video, tint: 'text-purple-400' },
  'music': { Icon: Music, tint: 'text-amber-400' },
  'map': { Icon: MapIcon, tint: 'text-cyan-400' },
  'database': { Icon: Database, tint: 'text-orange-400' },
  'package': { Icon: Package, tint: 'text-muted-foreground' },
  'check-square': { Icon: CheckSquare, tint: 'text-muted-foreground' },
  'brain': { Icon: Brain, tint: 'text-muted-foreground' },
  'users': { Icon: Users, tint: 'text-muted-foreground' },
  'git-branch': { Icon: GitBranch, tint: 'text-muted-foreground' },
  'calendar': { Icon: Calendar, tint: 'text-muted-foreground' },
  'graduation-cap': { Icon: GraduationCap, tint: 'text-muted-foreground' },
  'workflow': { Icon: GitBranch, tint: 'text-muted-foreground' },
}
const FALLBACK_ICON = { Icon: Package, tint: 'text-muted-foreground' }

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
  const [debug] = useDebug()

  const renderers = useSyncExternalStore(
    subscribeSearchHitRenderers,
    getSearchHitRenderersSnapshot,
    getSearchHitRenderersSnapshot,
  )

  const search = useSearch({
    limit: 30,
    types: activeTypes.length > 0 ? activeTypes : undefined,
  })

  const onOpen = useCallback(() => {
    // Search is cross-plugin: lazy-loaded clients (schedule, team, …) only
    // register their hit renderers when their bundle loads. Demand them all
    // so every hit renders with its real renderer, not the inert default.
    requestAllPlugins()
    setOpen(true)
  }, [])
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
      onOpenChange={(next) => { if (!next) close(); else onOpen() }}
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
          <CommandGroup
            key={type}
            heading={(
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/70">{type.replace(/[_-]/g, ' ')}</span>
                <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">{results.length}</span>
                <span className="h-px flex-1 bg-border" />
              </span>
            )}
            data-testid={`global-search-group-${type}`}
          >
            <div className={viewMode === 'card' ? 'grid gap-3 p-1 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]' : undefined}>
              {results.map((result) => {
                const renderer = renderers.get(type)
                const descriptor = renderer ? renderer(result) : defaultDescriptor(result)
                const thumbSrc = descriptor.thumbnailUrl && !brokenThumbs.has(descriptor.thumbnailUrl)
                  ? descriptor.thumbnailUrl
                  : undefined
                const { Icon, tint } = (descriptor.icon && HIT_ICONS[descriptor.icon]) || FALLBACK_ICON
                // No href = nowhere to go: render visibly inert instead of
                // masquerading as a clickable card (onSelect already no-ops).
                const inert = !descriptor.href
                const inertProps = inert
                  ? { 'data-inert': 'true' as const, 'aria-disabled': true }
                  : {}
                const media = (sizeClass: string, iconClass: string) => thumbSrc ? (
                  <img
                    src={thumbSrc}
                    alt=""
                    className={`${sizeClass} rounded-md object-cover`}
                    onError={() => setBrokenThumbs((prev) => new Set(prev).add(descriptor.thumbnailUrl!))}
                  />
                ) : (
                  <div className={`flex ${sizeClass} items-center justify-center rounded-md bg-muted`}>
                    <Icon className={`${iconClass} opacity-60 ${tint}`} />
                  </div>
                )
                return viewMode === 'card' ? (
                  <CommandItem
                    key={`${type}:${result.id}`}
                    value={`${type}:${result.id}`}
                    onSelect={() => onSelect(descriptor)}
                    className={`flex flex-col items-stretch gap-2 rounded-xl border p-3 ${inert ? 'opacity-60 cursor-default data-[selected=true]:bg-accent/40' : ''}`}
                    data-testid={`global-search-hit-${result.id}`}
                    {...inertProps}
                  >
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt=""
                        className="aspect-square w-full rounded-lg bg-zinc-900/50 object-cover"
                        onError={() => setBrokenThumbs((prev) => new Set(prev).add(descriptor.thumbnailUrl!))}
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-zinc-900/50">
                        <Icon className={`size-10 opacity-40 ${tint}`} />
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
                    className={`flex items-center gap-4 rounded-lg px-4 py-3 ${inert ? 'opacity-60 cursor-default data-[selected=true]:bg-accent/40' : ''}`}
                    data-testid={`global-search-hit-${result.id}`}
                    {...inertProps}
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
