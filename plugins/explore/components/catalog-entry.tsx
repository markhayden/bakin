import { Check } from 'lucide-react'
import { useAgent, useAgentColor, useAgentDisplayName } from '@makinbakin/sdk/hooks'
import { AgentAvatar } from '@makinbakin/sdk/patterns'
import { Avatar, AvatarFallback, AvatarImage } from '@makinbakin/sdk/ui'
import type { ExploreCatalogEntry } from '../types'

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
export function EntryVisual({ entry, size = 'md' }: { entry: ExploreCatalogEntry; size?: 'sm' | 'md' | 'lg' }) {
  const registeredAgentId = entry.kind === 'agent' && entry.installed ? entry.id : ''
  const registeredAgent = useAgent(registeredAgentId)
  const registeredAgentName = useAgentDisplayName(registeredAgentId)
  const registeredAgentColor = useAgentColor(registeredAgentId)

  const avatarSize = size === 'sm' ? 'sm' : size === 'lg' ? 'xl' : 'lg'

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
