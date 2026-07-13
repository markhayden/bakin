'use client'

import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface StatTileProps {
  icon?: ComponentType<{ className?: string }>
  /** Uppercase micro-label above the number. */
  label: ReactNode
  /** The big number (tabular). */
  value: ReactNode
  /** Small line under the number (unit, denominator, context). */
  sub?: ReactNode
  /** Optional meter under the number — `tone` follows the status scale. */
  progress?: { percent: number; tone?: 'success' | 'warning' | 'destructive' }
  /** Makes the tile a jump link. */
  onClick?: () => void
  className?: string
}

const PROGRESS_TONE = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
} as const

/**
 * THE metric tile (promoted from the brands overview; ≥7 surfaces hand-rolled
 * the same label + big-number card with drifting styles): icon + uppercase
 * micro-label, `text-2xl tabular-nums` value, optional sublabel and meter.
 */
export function StatTile({ icon: Icon, label, value, sub, progress, onClick, className }: StatTileProps) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp
      className={cn(
        'rounded-xl bg-card p-3.5 text-left ring-1 ring-foreground/10 transition-all',
        onClick && 'hover:bg-foreground/5 hover:ring-foreground/20',
        className,
      )}
      onClick={onClick}
      data-stat-tile
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        <p className="text-[11px] uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {progress && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
          <div
            className={cn('h-full rounded-full transition-all', PROGRESS_TONE[progress.tone ?? 'success'])}
            style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
          />
        </div>
      )}
      {sub && <p className={cn('text-[11px] text-muted-foreground', progress && 'mt-1.5')}>{sub}</p>}
    </Cmp>
  )
}
