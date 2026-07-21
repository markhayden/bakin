'use client'

import type { ComponentType, ReactNode } from 'react'
import { StatTile as StatTilePresentation } from '@makinbakin/sdk/patterns'

export interface StatTileProps {
  icon?: ComponentType<{ className?: string }>
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  progress?: { percent: number; tone?: 'success' | 'warning' | 'destructive' }
  onClick?: () => void
  className?: string
}

/** Compatibility adapter that retains the existing card treatment until surface migration. */
export function StatTile({ progress, ...props }: StatTileProps) {
  return (
    <StatTilePresentation
      {...props}
      variant="surface"
      progress={progress
        ? {
            percent: progress.percent,
            tone: progress.tone === 'warning'
              ? 'attention'
              : progress.tone === 'destructive'
                ? 'danger'
                : 'success',
          }
        : undefined}
    />
  )
}
