import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '../utils'

export type ChartExplainerProps = ComponentPropsWithoutRef<'p'>

/** Plain-language context for what a chart means and when a user should act. */
export function ChartExplainer({ children, className, ...props }: ChartExplainerProps) {
  return (
    <p
      {...props}
      role="note"
      className={cn('mt-bakin-2 flex items-start gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-muted', className)}
    >
      <span aria-hidden="true" className="select-none">ℹ</span>
      <span>{children}</span>
    </p>
  )
}
