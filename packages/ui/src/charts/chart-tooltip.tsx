export interface ChartTooltipProps {
  id: string
  text: string
  xPercent: number
  yPercent: number
}

function clampPercent(value: number): number {
  return Math.min(88, Math.max(12, value))
}

/** Shared non-animated tooltip used identically by pointer and keyboard focus. */
export function ChartTooltip({ id, text, xPercent, yPercent }: ChartTooltipProps) {
  const placement = yPercent <= 24 ? 'below' : 'above'

  return (
    <div
      id={id}
      role="tooltip"
      data-placement={placement}
      className={`pointer-events-none absolute z-10 max-w-56 -translate-x-1/2 rounded-bakin-overlay border border-bakin-border-subtle bg-bakin-surface-default px-bakin-2 py-bakin-1 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-primary shadow-bakin-elevation-overlay ${
        placement === 'below' ? 'translate-y-bakin-2' : '-translate-y-full'
      }`}
      style={{ left: `${clampPercent(xPercent)}%`, top: `${Math.max(8, yPercent)}%` }}
    >
      {text}
    </div>
  )
}
