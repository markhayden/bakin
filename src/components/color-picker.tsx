'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const PRESET_COLORS = [
  '#60a5fa', // blue
  '#4ade80', // green
  '#a78bfa', // violet
  '#fb923c', // orange
  '#a1a1aa', // zinc
  '#34d399', // emerald
  '#22d3ee', // cyan
  '#fbbf24', // amber
  '#f472b6', // pink
  '#ef4444', // red
  '#6366f1', // indigo
  '#14b8a6', // teal
]

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  className?: string
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  return (
    <div className={cn('grid grid-cols-6 gap-2', className)}>
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={cn(
            'size-8 rounded-full flex items-center justify-center transition-all',
            'ring-2 ring-offset-2 ring-offset-background',
            value === color ? 'ring-foreground' : 'ring-transparent hover:ring-muted-foreground'
          )}
          style={{ backgroundColor: color }}
        >
          {value === color && <Check className="size-3.5 text-white drop-shadow" />}
        </button>
      ))}
    </div>
  )
}
