'use client'

import { ColorPicker as ColorPickerPresentation } from '@makinbakin/sdk/patterns'

const PRESET_COLORS = [
  { value: '#60a5fa', label: 'Blue' },
  { value: '#4ade80', label: 'Green' },
  { value: '#a78bfa', label: 'Violet' },
  { value: '#fb923c', label: 'Orange' },
  { value: '#a1a1aa', label: 'Neutral' },
  { value: '#34d399', label: 'Emerald' },
  { value: '#22d3ee', label: 'Cyan' },
  { value: '#fbbf24', label: 'Amber' },
  { value: '#f472b6', label: 'Pink' },
  { value: '#ef4444', label: 'Red' },
  { value: '#6366f1', label: 'Indigo' },
  { value: '#14b8a6', label: 'Teal' },
] as const

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  className?: string
}

/** Compatibility adapter preserving the historical agent-color palette values. */
export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  return (
    <ColorPickerPresentation
      ariaLabel="Agent color"
      value={value}
      onValueChange={onChange}
      options={PRESET_COLORS.map((option) => ({ ...option, color: option.value }))}
      className={className}
    />
  )
}
