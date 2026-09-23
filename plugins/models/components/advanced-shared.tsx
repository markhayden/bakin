'use client'

/**
 * Pieces the three Advanced tabs share: the guidance card that opens each
 * tab in plain words (what this is, why you'd use it, what to weigh), the
 * "unsaved" chip, and the thinking-level select filtered to what the
 * runtime honors.
 */
import type { ComponentType, ReactNode } from 'react'
import { Grid } from '@makinbakin/sdk/layout'
import { Badge, Card, CardContent, CardDescription, CardTitle, Overline, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text } from '@makinbakin/sdk/ui'

// The full ordered ladder; the active runtime's declared support filters it.
export const ALL_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const
export const THINKING_LABELS: Record<string, string> = {
  inherit: 'Inherit agent setting',
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  adaptive: 'Adaptive',
  max: 'Maximum',
}

export function StagedMark({ staged }: { staged: boolean }) {
  return staged ? <Badge tone="attention" variant="soft" size="xs">unsaved</Badge> : null
}

export interface GuideCardProps {
  icon?: ComponentType<{ className?: string }>
  title: string
  /** One or two sentences: what this tab controls and why it exists. */
  lead: string
  /** "What to think about" — short, concrete points a new user can act on. */
  points: ReadonlyArray<{ heading: string; body: string }>
  actions?: ReactNode
}

/** Opens each Advanced tab: the purpose in plain words, then the things worth weighing as a railed strip (the stat-strip rhythm, with prose in place of numbers). */
export function GuideCard({ icon: Icon, title, lead, points, actions }: GuideCardProps) {
  return (
    <Card data-slot="models-guide" className="bg-bakin-surface-subtle">
      {/* One icon gutter for the whole card: title, lead AND the strip share the same left edge. */}
      <CardContent className="flex min-w-0 items-start gap-bakin-3 pt-bakin-6">
        {Icon ? (
          <span aria-hidden="true" className="mt-bakin-1 flex size-bakin-8 shrink-0 items-center justify-center rounded-bakin-pill bg-bakin-action-primary-background/10 text-bakin-action-primary-background">
            <Icon className="size-bakin-4" />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-bakin-5">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
            <div className="min-w-0">
              <CardTitle>{title}</CardTitle>
              <CardDescription className="mt-bakin-1 max-w-prose leading-relaxed">{lead}</CardDescription>
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-bakin-2">{actions}</div> : null}
          </div>
          <Grid layout="thirds" gap="item" align="stretch" data-testid="guide-points">
            {points.map((point) => (
              <div key={point.heading} className="min-w-0 border-s border-bakin-border-subtle py-bakin-2 ps-bakin-4">
                <Overline>{point.heading}</Overline>
                <Text as="p" size="meta" tone="muted" className="mt-bakin-2 leading-relaxed">{point.body}</Text>
              </div>
            ))}
          </Grid>
        </div>
      </CardContent>
    </Card>
  )
}

export function ThinkingSelect({ id, label, value, supported, disabled, onChange }: {
  id: string
  label: string
  value: string | null
  supported: readonly string[]
  disabled?: boolean
  onChange: (value: string | null) => void
}) {
  const levels = ['inherit', ...supported]
  const items = Object.fromEntries([...levels, ...ALL_THINKING_LEVELS].map((level) => [level, THINKING_LABELS[level] ?? level]))
  return (
    <Select items={items} value={value ?? 'inherit'} onValueChange={(next) => onChange(!next || next === 'inherit' ? null : next)} disabled={disabled}>
      <SelectTrigger id={id} size="sm" aria-label={label} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {levels.map((level) => (
          <SelectItem key={level} value={level}>{THINKING_LABELS[level] ?? level}</SelectItem>
        ))}
        {value && !levels.includes(value) ? (
          <SelectItem value={value}>{THINKING_LABELS[value] ?? value} · unsupported by this runtime</SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  )
}
