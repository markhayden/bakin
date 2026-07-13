import { Check, Plus } from 'lucide-react'
import { AgentAvatar } from '@makinbakin/sdk/components'
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

/**
 * Installed agents get their real headshot from the local agent store;
 * uninstalled entries use the catalog's iconUrl when it ships one
 * (bits-repo asset), else the emoji.
 */
export function EntryVisual({ entry, size = 'md' }: { entry: ExploreCatalogEntry; size?: 'md' | 'lg' }) {
  if (entry.kind === 'agent' && entry.installed) {
    return <AgentAvatar agentId={entry.id} size={size === 'lg' ? 'xl' : 'lg'} />
  }
  if (entry.iconUrl) {
    return (
      <img
        src={entry.iconUrl}
        alt={entry.name}
        loading="lazy"
        data-testid={`icon-${entry.kind}-${entry.id}`}
        className={`${size === 'lg' ? 'size-12' : 'size-9'} shrink-0 rounded-full border border-border object-cover object-top`}
      />
    )
  }
  return <span className={size === 'lg' ? 'text-3xl leading-none' : 'text-2xl leading-none'}>{entry.emoji ?? '📦'}</span>
}

export function CatalogCard({
  entry,
  onSelect,
  onInstall,
}: {
  entry: ExploreCatalogEntry
  onSelect: (entry: ExploreCatalogEntry) => void
  /** Renders an Install button directly on available cards. */
  onInstall?: (entry: ExploreCatalogEntry) => void
}) {
  const status = entryStatusBadge(entry)
  const installable = !entry.builtin && !entry.installed && onInstall !== undefined
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      data-testid={`catalog-card-${entry.kind}-${entry.id}`}
      className="flex flex-col gap-2 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/25"
    >
      <div className="flex items-center gap-2.5">
        <EntryVisual entry={entry} />
        <span className="font-medium text-foreground">{entry.name}</span>
        <Badge variant="outline" className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {entry.category}
        </Badge>
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{entry.description}</p>
      {entry.useCases[0] && (
        <p className="line-clamp-1 text-xs text-muted-foreground/80">e.g. {entry.useCases[0]}</p>
      )}
      <div className="mt-auto flex items-center gap-2 pt-1.5">
        {status && (
          <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${TONE_CLASSES[status.tone]}`}>
            {status.tone === 'installed' && <Check className="size-3" />}
            {status.label}
          </span>
        )}
        {installable && (
          <span
            role="button"
            tabIndex={0}
            data-testid={`card-install-${entry.kind}-${entry.id}`}
            onClick={(event) => {
              event.stopPropagation()
              onInstall(entry)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onInstall(entry)
              }
            }}
            className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
          >
            <Plus className="size-3" />
            Install
          </span>
        )}
        {entry.installedVersion && (
          <span className="ml-auto text-[11px] text-muted-foreground/60" data-testid="card-version">
            v{entry.installedVersion}
          </span>
        )}
      </div>
    </button>
  )
}
