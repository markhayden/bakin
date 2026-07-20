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
  return (
    <div
      id={id}
      role="tooltip"
      className="pointer-events-none absolute z-10 max-w-56 -translate-x-1/2 -translate-y-full rounded-bakin-overlay border border-bakin-border-subtle bg-bakin-surface-default px-bakin-2 py-bakin-1 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-primary shadow-bakin-elevation-overlay"
      style={{ left: `${clampPercent(xPercent)}%`, top: `${Math.max(8, yPercent)}%` }}
    >
      {text}
    </div>
  )
}
