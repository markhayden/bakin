'use client'

/**
 * Pieces the three Advanced tabs share: the guidance card that opens each
 * tab in plain words (what this is, why you'd use it, what to weigh), the
 * "unsaved" chip, and the thinking-level select filtered to what the
 * runtime honors.
 */
import type { ComponentType, ReactNode } from 'react'
import { DisclosurePanel } from '@makinbakin/sdk/layout'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text } from '@makinbakin/sdk/ui'

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

/** Opens each Advanced tab: the purpose in plain words always visible; the things worth weighing one click away, stacked. */
export function GuideCard({ icon: Icon, title, lead, points, actions }: GuideCardProps) {
  return (
    <Card data-slot="models-guide" className="bg-bakin-surface-subtle">
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
          <div className="flex min-w-0 items-start gap-bakin-3">
            {Icon ? (
              <span aria-hidden="true" className="mt-bakin-1 flex size-bakin-8 shrink-0 items-center justify-center rounded-bakin-pill bg-bakin-action-primary-background/10 text-bakin-action-primary-background">
                <Icon className="size-bakin-4" />
              </span>
            ) : null}
            <div className="min-w-0">
              <CardTitle>{title}</CardTitle>
              <CardDescription className="mt-bakin-1 max-w-prose leading-relaxed">{lead}</CardDescription>
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-bakin-2">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent>
        <DisclosurePanel variant="ghost" summary="What to consider" summaryMeta={`${points.length} points`} data-testid="guide-points">
          <ul className="m-0 flex list-none flex-col gap-bakin-3 p-0">
            {points.map((point) => (
              <li key={point.heading} className="min-w-0 max-w-prose">
                <span className="font-bakin-typography-weight-semibold text-bakin-text-primary">{point.heading}</span>
                <Text as="span" size="meta" tone="muted" className="leading-relaxed"> — {point.body}</Text>
              </li>
            ))}
          </ul>
        </DisclosurePanel>
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
