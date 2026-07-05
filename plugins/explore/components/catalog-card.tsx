import { Badge } from '@makinbakin/sdk/ui'
import type { ExploreCatalogEntry } from '../types'

export function entryStatusBadge(entry: ExploreCatalogEntry): { label: string; tone: 'builtin' | 'installed' | 'update' } | null {
  if (entry.builtin) return { label: 'Built in', tone: 'builtin' }
  if (entry.updateAvailable === true) return { label: 'Update available', tone: 'update' }
  if (entry.installed) return { label: 'Installed', tone: 'installed' }
  return null
}

const TONE_CLASSES: Record<'builtin' | 'installed' | 'update', string> = {
  builtin: 'border-border bg-[rgba(255,255,255,0.06)] text-muted-foreground',
  installed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  update: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
}

export function CatalogCard({
  entry,
  onSelect,
}: {
  entry: ExploreCatalogEntry
  onSelect: (entry: ExploreCatalogEntry) => void
}) {
  const status = entryStatusBadge(entry)
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      data-testid={`catalog-card-${entry.kind}-${entry.id}`}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 hover:bg-accent/40"
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl leading-none">{entry.emoji ?? '📦'}</span>
        <span className="font-medium text-foreground">{entry.name}</span>
        <Badge variant="outline" className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {entry.category}
        </Badge>
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{entry.description}</p>
      {entry.useCases[0] && (
        <p className="line-clamp-1 text-xs text-muted-foreground/80">e.g. {entry.useCases[0]}</p>
      )}
      <div className="mt-auto flex items-center gap-2 pt-1">
        {status && (
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${TONE_CLASSES[status.tone]}`}>
            {status.label}
          </span>
        )}
        {!status && <span className="text-[11px] text-muted-foreground/60">Tap for details</span>}
      </div>
    </button>
  )
}
