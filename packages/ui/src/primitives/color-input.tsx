'use client'

import type { AriaAttributes } from 'react'

import { cn, focusRing } from '../utils'

export interface ColorInputProps extends Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> {
  /** Current color. Non-hex values render on the swatch as a safe fallback. */
  value: string
  /** Fires with a normalized `#rrggbb` hex from the platform color dialog. */
  onValueChange: (hex: string) => void
  ariaLabel?: string
  id?: string
  name?: string
  disabled?: boolean
  className?: string
  /** Swatch color shown while `value` is not a valid hex (default black). */
  fallback?: string
}

const FALLBACK_SWATCH = '#000000'
const fullHex = /^#[0-9a-f]{6}$/i
const shortHex = /^#[0-9a-f]{3}$/i

function swatchHex(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (fullHex.test(trimmed)) return trimmed.toLowerCase()
  // Expand #rgb so the native control (which requires #rrggbb) still tracks it.
  if (shortHex.test(trimmed)) {
    return `#${[...trimmed.slice(1)].map((c) => c + c).join('')}`.toLowerCase()
  }
  return fullHex.test(fallback) ? fallback.toLowerCase() : FALLBACK_SWATCH
}

/**
 * Freeform color choice styled as a kit swatch over the platform color
 * dialog. Complements `ColorPicker` (a fixed set of options): use ColorInput
 * when any color is valid and the consumer owns the value — typically paired
 * with a text field showing the same hex.
 */
export function ColorInput({
  value,
  onValueChange,
  ariaLabel = 'Choose color',
  id,
  name,
  disabled = false,
  className,
  fallback = FALLBACK_SWATCH,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: ColorInputProps) {
  return (
    <input
      type="color"
      id={id}
      name={name}
      value={swatchHex(value, fallback)}
      onChange={(event) => onValueChange(event.target.value)}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      disabled={disabled}
      data-color-input=""
      data-slot="color-input"
      className={cn(
        'size-bakin-8 shrink-0 cursor-pointer appearance-none rounded-bakin-control border border-bakin-border-subtle bg-bakin-canvas-default p-bakin-1',
        focusRing,
        'aria-invalid:border-bakin-signal-danger',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[var(--bakin-state-opacity-disabled)]',
        '[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[calc(var(--bakin-radius-control)-2px)] [&::-webkit-color-swatch]:border-none',
        '[&::-moz-color-swatch]:rounded-[calc(var(--bakin-radius-control)-2px)] [&::-moz-color-swatch]:border-none',
        className,
      )}
    />
  )
}
