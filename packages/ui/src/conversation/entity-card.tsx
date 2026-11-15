import { createContext, use, type ReactElement, type ReactNode } from 'react'

import { Card, CardContent, CardMedia } from '../primitives/card'
import type { ConversationEntityRef } from './fold'

const ACTION_LABEL: Record<ConversationEntityRef['action'], string> = {
  created: 'Created',
  updated: 'Updated',
}

/** Props for one entity card: a resolved kind plus the reference's snapshot. */
export interface EntityCardProps {
  /** The kind's display name ("Project"). */
  label: string
  /** The entity's title at the time of the tool call. */
  title: string
  action: ConversationEntityRef['action']
  /** The kind's icon, decorative. */
  icon?: ReactNode
  /**
   * The navigation element for the entity's page (a client-routed link). It
   * becomes the whole-card overlay. Omit when the kind cannot be resolved —
   * its plugin was removed — and the card renders as plain, non-link content.
   */
  link?: ReactElement<{ className?: string }>
}

/**
 * A link to something an agent created or changed, shown in its reply at the
 * point it happened. Composes the row `Card`: icon tile, title, and a
 * "Kind · Created" line; the whole card is one link.
 */
export function EntityCard({ label, title, action, icon, link }: EntityCardProps) {
  return (
    <Card
      orientation="row"
      data-conv-entity=""
      interactive={link ? { label: `Open ${label.toLowerCase()}: ${title}`, render: link } : undefined}
    >
      {icon ? (
        <CardMedia
          aria-hidden="true"
          className="flex items-center justify-center bg-bakin-surface-elevated px-bakin-3 text-bakin-text-muted [&_svg]:size-bakin-4"
        >
          {icon}
        </CardMedia>
      ) : null}
      <CardContent className="flex min-w-0 flex-1 flex-col justify-center gap-bakin-1 py-bakin-2">
        <span className="truncate font-bakin-typography-weight-semibold" title={title}>{title}</span>
        <span className="truncate text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
          {label} · {ACTION_LABEL[action]}
        </span>
      </CardContent>
    </Card>
  )
}

/** What the surrounding app knows about a reference's kind. */
export interface ResolvedEntityKind {
  label: string
  icon?: ReactNode
  link?: ReactElement<{ className?: string }>
}

/** Resolves a reference's kind to its display name, icon and link; `null` when the kind is unknown. */
export type EntityKindResolver = (ref: ConversationEntityRef) => ResolvedEntityKind | null

/** "projects:project" → "Project": the fallback when nothing resolves the kind. */
function fallbackLabel(kind: string): string {
  const name = kind.slice(kind.indexOf(':') + 1).replace(/-/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const resolveNothing: EntityKindResolver = () => null

/**
 * How entity cards learn a kind's label, icon and link. The host provides the
 * resolver once, above every conversation surface. An unresolved kind — no
 * resolver, or a kind whose plugin was removed — renders as plain content
 * named after the kind.
 */
export const EntityKindResolverContext = createContext<EntityKindResolver>(resolveNothing)

/** The cards for one `entities` turn item. */
export function EntityCards({ refs }: { refs: readonly ConversationEntityRef[] }) {
  const resolve = use(EntityKindResolverContext)
  return (
    <ul data-conv-entities="" aria-label="Created and updated" className="grid min-w-0 max-w-md list-none grid-cols-1 gap-bakin-2 p-0">
      {refs.map((ref) => (
        <li key={`${ref.kind}:${ref.id}`} className="min-w-0">
          <EntityCard {...(resolve(ref) ?? { label: fallbackLabel(ref.kind) })} title={ref.title} action={ref.action} />
        </li>
      ))}
    </ul>
  )
}
