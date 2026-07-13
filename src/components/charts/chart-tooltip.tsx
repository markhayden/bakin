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
      className="pointer-events-none absolute z-10 max-w-56 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
      style={{ left: `${clampPercent(xPercent)}%`, top: `${Math.max(8, yPercent)}%` }}
    >
      {text}
    </div>
  )
}
