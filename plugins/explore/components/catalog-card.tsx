import { Check, Plus } from 'lucide-react'
import { useAgent, useAgentColor, useAgentDisplayName } from '@makinbakin/sdk/hooks'
import { AgentAvatar, StatusBadge } from '@makinbakin/sdk/patterns'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Overline,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { runtimeCompatible, type ExploreCatalogEntry } from '../types'
import { Inline } from '@makinbakin/sdk/layout'

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

  const avatarSize = size === 'lg' ? 'xl' : 'lg'

  if (entry.kind === 'agent' && entry.installed) {
    return (
      <AgentAvatar
        agent={{
          id: entry.id,
          name: registeredAgentName ?? registeredAgent?.name ?? entry.name,
          imageSrc: registeredAgent?.headshot || entry.iconUrl,
          color: registeredAgent ? registeredAgentColor : undefined,
        }}
        size={avatarSize}
      />
    )
  }
  // Catalog icon when the bits repo ships one, emoji otherwise — the kit
  // Avatar owns the frame and the image/fallback swap, so the two branches
  // stay pixel-identical and the sizes match the AgentAvatar above.
  // Decorative: the card title / drawer title already names the entry.
  return (
    <Avatar
      size={avatarSize}
      aria-hidden="true"
      data-testid={entry.iconUrl ? `icon-${entry.kind}-${entry.id}` : undefined}
    >
      {entry.iconUrl ? <AvatarImage src={entry.iconUrl} alt="" loading="lazy" className="object-top" /> : null}
      <AvatarFallback>{entry.emoji ?? '📦'}</AvatarFallback>
    </Avatar>
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
  const requiredRuntimes = (entry.runtimes ?? []).join(', ')
  const status = entryStatusBadge(entry)
  const installable = !entry.builtin && !entry.installed && onInstall !== undefined && compatible
  return (
    <Card
      size="sm"
      data-testid={`catalog-card-${entry.kind}-${entry.id}`}
      className="h-full"
      interactive={{ label: `View ${entry.name} details`, onActivate: () => onSelect(entry) }}
    >
      <CardHeader>
        <Inline wrap={false}>
          <EntryVisual entry={entry} />
          <div className="flex min-w-0 flex-1 items-center gap-bakin-2">
            <CardTitle className="min-w-0 flex-1 group-data-[size=sm]/card:text-bakin-typography-size-section-title">
              {entry.name}
            </CardTitle>
            <Overline className="shrink-0">
              {entry.category}
            </Overline>
          </div>
        </Inline>
      </CardHeader>
      <CardContent className="flex-1">
        <CardDescription className="line-clamp-2 leading-snug">{entry.description}</CardDescription>
      </CardContent>
      <CardFooter variant="meta" className="gap-bakin-2">
        <Inline gap="dense">
          {status && (
            <StatusBadge tone={status.tone} variant={status.variant} icon={status.icon} size="xs">
              {status.label}
            </StatusBadge>
          )}
          {!compatible && (
            <Tooltip>
              {/* The chip stays short so the footer never wraps; the full
                  requirement rides the tooltip for pointers and the appended
                  text for assistive tech, so neither audience is left with
                  only "Not for <adapter>". The requirement is TEXT, not an
                  aria-label: StatusBadge renders a role-less span, and ARIA
                  prohibits naming a generic — the label was being dropped. */}
              <TooltipTrigger
                render={(
                  <StatusBadge
                    data-testid={`card-incompatible-${entry.id}`}
                    tone="neutral"
                    size="xs"
                  >
                    Not for {activeAdapter ?? 'this runtime'}
                    <span className="sr-only"> — requires runtime: {requiredRuntimes}</span>
                  </StatusBadge>
                )}
              />
              <TooltipContent>Requires runtime: {requiredRuntimes}</TooltipContent>
            </Tooltip>
          )}
          {entry.installedVersion ? (
            <Text size="meta" tone="muted" data-testid="card-version">
              v{entry.installedVersion}
            </Text>
          ) : null}
        </Inline>
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
