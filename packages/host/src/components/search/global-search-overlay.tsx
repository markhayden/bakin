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
  Image as ImageIcon, FileText, Music, Video, Map as MapIcon, Database,
  Package, CheckSquare, Brain, Users, GitBranch, Calendar, GraduationCap,
  LayoutGrid, List as ListIcon, Paintbrush,
  type LucideIcon,
} from 'lucide-react'
import { useSearch, useDebug, type SearchResult } from '@makinbakin/sdk/hooks'
import {
  ScoreOverlay,
  SearchPartialChip,
  SearchUnavailable,
  SegmentedControl,
  computeMatchedFields,
} from '@makinbakin/sdk/patterns'
import { type SearchHitDescriptor } from '@makinbakin/sdk'
import {
  getSearchHitRenderersSnapshot,
  requestAllPlugins,
  subscribeSearchHitRenderers,
} from '@makinbakin/sdk/internal'
import {
  Button,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Overline,
  SystemState,
} from '@makinbakin/sdk/ui'
import { useSearchHotkey } from './use-search-hotkey'
import { cn } from '@makinbakin/sdk/utils'

const TABLE_PREFIX = 'bakin_'

/** Renderer `icon` names → icon. The asset types mirror the assets page's
 *  TYPE_ICONS so global search reads the same; anything unknown gets the
 *  neutral Package — never a question mark. */
const HIT_ICONS: Record<string, LucideIcon> = {
  'file-text': FileText,
  'image': ImageIcon,
  'video': Video,
  'music': Music,
  'map': MapIcon,
  'database': Database,
  'package': Package,
  'check-square': CheckSquare,
  'brain': Brain,
  'users': Users,
  'git-branch': GitBranch,
  'calendar': Calendar,
  'graduation-cap': GraduationCap,
  'workflow': GitBranch,
  'paintbrush': Paintbrush,
}
const FALLBACK_ICON = Package

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
      <div className="flex flex-wrap items-center gap-1.5 border-b border-bakin-border-subtle px-bakin-3 py-bakin-2" data-testid="global-search-chips">
        {chipTypes.map((type) => (
          <Button
            key={type}
            size="xs"
            variant={activeTypes.includes(type) ? 'secondary' : 'outline'}
            aria-pressed={activeTypes.includes(type)}
            onClick={() => toggleType(type)}
            className="rounded-bakin-pill capitalize"
            data-testid={`global-search-chip-${type}`}
          >
            {type}
          </Button>
        ))}
        <SearchPartialChip meta={search.meta} className="ml-bakin-1" />
        <SegmentedControl
          ariaLabel="Result view"
          className="ml-auto"
          value={viewMode}
          onValueChange={switchView}
          options={[
            { value: 'card', label: 'Card view', icon: LayoutGrid, hideLabel: true },
            { value: 'list', label: 'List view', icon: ListIcon, hideLabel: true },
          ]}
        />
      </div>
      <CommandList className="max-h-none flex-1 overflow-y-auto">
        {search.status === 'unavailable' && (
          <SearchUnavailable retry={search.retry} className="py-10" />
        )}
        {search.status === 'error' && (
          <div className="p-bakin-6" data-testid="global-search-error">
            <SystemState
              kind="error"
              recovery="unavailable"
              scope="section"
              title="Search failed"
              description={search.error}
            />
          </div>
        )}
        {search.status === 'loading' && (
          <div className="p-bakin-6" data-testid="global-search-spinner">
            <SystemState kind="loading" scope="section" title="Searching" />
          </div>
        )}
        {search.status === 'idle' && (
          <div className="p-bakin-6 text-center text-sm text-bakin-text-muted">
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
              <span className="flex items-center gap-bakin-2">
                <Overline>{type.replace(/[_-]/g, ' ')}</Overline>
                <span className="rounded-bakin-pill bg-bakin-surface-default px-1.5 py-px text-bakin-typography-size-meta tabular-nums text-bakin-text-muted">{results.length}</span>
                <span className="h-px flex-1 bg-bakin-border-subtle" />
              </span>
            )}
            data-testid={`global-search-group-${type}`}
          >
            <div className={viewMode === 'card' ? 'grid gap-bakin-3 p-bakin-1 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]' : undefined}>
              {results.map((result) => {
                const renderer = renderers.get(type)
                const descriptor = renderer ? renderer(result) : defaultDescriptor(result)
                const thumbSrc = descriptor.thumbnailUrl && !brokenThumbs.has(descriptor.thumbnailUrl)
                  ? descriptor.thumbnailUrl
                  : undefined
                const Icon = (descriptor.icon && HIT_ICONS[descriptor.icon]) || FALLBACK_ICON
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
                    className={cn(sizeClass, 'rounded-bakin-control object-cover')}
                    onError={() => setBrokenThumbs((prev) => new Set(prev).add(descriptor.thumbnailUrl!))}
                  />
                ) : (
                  <div className={cn('flex', sizeClass, 'items-center justify-center rounded-bakin-control bg-bakin-surface-default')}>
                    <Icon className={cn(iconClass, 'text-bakin-text-muted')} />
                  </div>
                )
                return viewMode === 'card' ? (
                  <CommandItem
                    key={`${type}:${result.id}`}
                    value={`${type}:${result.id}`}
                    onSelect={() => onSelect(descriptor)}
                    className={cn('flex flex-col items-stretch gap-bakin-2 rounded-bakin-surface border border-bakin-border-subtle p-bakin-3', inert ? 'opacity-60 cursor-default data-[selected=true]:bg-bakin-border-subtle/20' : '')}
                    data-testid={`global-search-hit-${result.id}`}
                    {...inertProps}
                  >
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt=""
                        className="aspect-square w-full rounded-bakin-control bg-bakin-canvas-default/50 object-cover"
                        onError={() => setBrokenThumbs((prev) => new Set(prev).add(descriptor.thumbnailUrl!))}
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded-bakin-control bg-bakin-canvas-default/50">
                        <Icon className="size-10 text-bakin-text-muted" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-sm font-bakin-typography-weight-medium">{descriptor.title}</div>
                      {descriptor.subtitle && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-bakin-text-muted">{descriptor.subtitle}</div>
                      )}
                      {descriptor.meta && (
                        <div className="mt-bakin-1 truncate text-bakin-typography-size-meta text-bakin-text-muted">{descriptor.meta}</div>
                      )}
                    </div>
                    {debug && (
                      <ScoreOverlay info={{ score: result.score, indexScores: result.indexScores, matchedFields: computeMatchedFields(query, result.fields) }} />
                    )}
                  </CommandItem>
                ) : (
                  <CommandItem
                    key={`${type}:${result.id}`}
                    value={`${type}:${result.id}`}
                    onSelect={() => onSelect(descriptor)}
                    className={cn('flex items-center gap-bakin-4 rounded-bakin-control px-bakin-4 py-bakin-3', inert ? 'opacity-60 cursor-default data-[selected=true]:bg-bakin-border-subtle/20' : '')}
                    data-testid={`global-search-hit-${result.id}`}
                    {...inertProps}
                  >
                    {media('size-16 shrink-0', 'size-bakin-6')}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-bakin-typography-weight-medium">{descriptor.title}</div>
                      {descriptor.subtitle && (
                        <div className="mt-0.5 line-clamp-2 text-sm text-bakin-text-muted">{descriptor.subtitle}</div>
                      )}
                      {descriptor.meta && (
                        <div className="mt-0.5 truncate text-xs text-bakin-text-muted">{descriptor.meta}</div>
                      )}
                    </div>
                    {debug && (
                      <ScoreOverlay info={{ score: result.score, indexScores: result.indexScores, matchedFields: computeMatchedFields(query, result.fields) }} />
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
