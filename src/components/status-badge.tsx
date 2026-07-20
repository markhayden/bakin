'use client'

import type { ComponentType, ReactNode } from 'react'
import {
  StatusBadge as StatusBadgePresentation,
  type StatusTone as PresentationStatusTone,
} from '@bakin/ui/patterns'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'destructive' | 'accent'

export interface StatusBadgeProps {
  tone?: StatusTone
  variant?: 'solid' | 'outline'
  icon?: ComponentType<{ className?: string }>
  className?: string
  children: ReactNode
}

const TONE: Record<StatusTone, PresentationStatusTone> = {
  neutral: 'neutral',
  success: 'success',
  warning: 'attention',
  destructive: 'danger',
  accent: 'accent',
}

/** Compatibility adapter for legacy tone names and the former soft `solid` default. */
export function StatusBadge({
  tone = 'neutral',
  variant = 'solid',
  ...props
}: StatusBadgeProps) {
  return (
    <StatusBadgePresentation
      {...props}
      tone={TONE[tone]}
      variant={variant === 'solid' ? 'soft' : 'outline'}
      data-status-badge={tone}
      data-legacy-status-tone={tone}
    />
  )
}
