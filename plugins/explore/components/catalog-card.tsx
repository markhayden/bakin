import { Check, Plus } from 'lucide-react'
import { useAgent, useAgentColor, useAgentDisplayName } from '@makinbakin/sdk/hooks'
import { AgentAvatar, StatusBadge } from '@makinbakin/sdk/patterns'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@makinbakin/sdk/ui'
import { runtimeCompatible, type ExploreCatalogEntry } from '../types'

export function entryStatusBadge(entry: ExploreCatalogEntry): {
  label: string
  tone: 'neutral' | 'success' | 'attention'
  variant: 'soft' | 'solid'
  icon?: typeof Check
} | null {
  if (entry.builtin) return { label: 'Built in', tone: 'neutral', variant: 'solid' }
  if (entry.updateAvailable === true) return { label: 'Update available', tone: 'attention', variant: 'solid' }
  if (entry.installed) return { label: 'Installed', tone: 'success', variant: 'soft', icon: Check }
  return null
}

/**
 * Installed agents get their real headshot from the local agent store;
 * uninstalled entries use the catalog's iconUrl when it ships one
 * (bits-repo asset), else the emoji.
 */
export function EntryVisual({ entry, size = 'md' }: { entry: ExploreCatalogEntry; size?: 'md' | 'lg' }) {
  const registeredAgentId = entry.kind === 'agent' && entry.installed ? entry.id : ''
  const registeredAgent = useAgent(registeredAgentId)
  const registeredAgentName = useAgentDisplayName(registeredAgentId)
  const registeredAgentColor = useAgentColor(registeredAgentId)

  if (entry.kind === 'agent' && entry.installed) {
    return (
      <AgentAvatar
        agent={{
          id: entry.id,
          name: registeredAgentName ?? registeredAgent?.name ?? entry.name,
          imageSrc: registeredAgent?.headshot || entry.iconUrl,
          color: registeredAgent ? registeredAgentColor : undefined,
        }}
        size={size === 'lg' ? 'xl' : 'lg'}
      />
    )
  }
  if (entry.iconUrl) {
    return (
      <img
        src={entry.iconUrl}
        alt={entry.name}
        loading="lazy"
        data-testid={`icon-${entry.kind}-${entry.id}`}
        className={`${size === 'lg' ? 'size-bakin-12' : 'size-bakin-8'} shrink-0 rounded-bakin-pill border border-bakin-border-subtle object-cover object-top`}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-bakin-control bg-bakin-surface-default leading-none ${
        size === 'lg'
          ? 'size-bakin-12 text-bakin-typography-size-title'
          : 'size-bakin-8 text-bakin-typography-size-section-title'
      }`}
    >
      {entry.emoji ?? '📦'}
    </span>
  )
}

export function CatalogCard({
  entry,
  onSelect,
  onInstall,
  activeAdapter,
}: {
  entry: ExploreCatalogEntry
  onSelect: (entry: ExploreCatalogEntry) => void
  /** Renders an Install button directly on available cards. */
  onInstall?: (entry: ExploreCatalogEntry) => void
  /** Active runtime adapter — runtime-tagged entries badge/gate against it. */
  activeAdapter?: string
}) {
  const compatible = runtimeCompatible(entry, activeAdapter)
  const status = entryStatusBadge(entry)
  const installable = !entry.builtin && !entry.installed && onInstall !== undefined && compatible
  return (
    <Card
      size="sm"
      data-testid={`catalog-card-${entry.kind}-${entry.id}`}
      className="h-full cursor-pointer transition-colors hover:border-bakin-border-strong"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a')) return
        onSelect(entry)
      }}
    >
      <CardHeader>
        <div className="flex min-w-0 items-center gap-bakin-3">
          <EntryVisual entry={entry} />
          <div className="flex min-w-0 flex-1 items-center gap-bakin-2">
            <CardTitle className="min-w-0 flex-1 group-data-[size=sm]/card:text-bakin-typography-size-section-title">
              {entry.name}
            </CardTitle>
            <span className="shrink-0 text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wide text-bakin-text-muted">
              {entry.category}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <CardDescription className="line-clamp-2 leading-snug">{entry.description}</CardDescription>
      </CardContent>
      <CardFooter className="mt-auto flex-wrap justify-between gap-bakin-2">
        <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
          {status && (
            <StatusBadge tone={status.tone} variant={status.variant} icon={status.icon} size="xs">
              {status.label}
            </StatusBadge>
          )}
          {!compatible && (
            <StatusBadge
              data-testid={`card-incompatible-${entry.id}`}
              title={`Requires runtime: ${(entry.runtimes ?? []).join(', ')}`}
              tone="neutral"
              size="xs"
            >
              Not for {activeAdapter ?? 'this runtime'}
            </StatusBadge>
          )}
          {entry.installedVersion ? (
            <span className="text-bakin-typography-size-meta text-bakin-text-muted" data-testid="card-version">
              v{entry.installedVersion}
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-bakin-1">
          <Button type="button" variant="ghost" size="xs" onClick={() => onSelect(entry)}>
            Details
          </Button>
          {installable ? (
            <Button
              type="button"
              size="xs"
              data-testid={`card-install-${entry.kind}-${entry.id}`}
              onClick={() => onInstall(entry)}
            >
              <Plus />
              Install
            </Button>
          ) : null}
        </div>
      </CardFooter>
    </Card>
  )
}
