'use client'

import { Badge } from '@makinbakin/sdk/ui'

/**
 * Shared "Stale" attention chip for canvas nodes whose step references a
 * stale workflow skill. One implementation so the drift signal reads the
 * same on agent, parallel, and output nodes. The detail rides
 * screen-reader text — never a title tooltip.
 */
export function StaleSkillChip({
  srLabel,
  children,
}: {
  srLabel: string
  children: React.ReactNode
}) {
  return (
    <Badge tone="attention" variant="soft" size="xs" className="shrink-0">
      {children}
      <span className="sr-only">{srLabel}</span>
    </Badge>
  )
}
