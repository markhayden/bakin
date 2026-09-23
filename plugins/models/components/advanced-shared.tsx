'use client'

/**
 * Pieces the three Advanced tabs share: the "unsaved" chip and the
 * thinking-level select filtered to what the runtime honors. (Each tab's
 * opener is the SDK `GuideCard`.)
 */
import { Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@makinbakin/sdk/ui'

// The full ordered ladder; the active runtime's declared support filters it.
export const ALL_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const
const THINKING_LABELS: Record<string, string> = {
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
