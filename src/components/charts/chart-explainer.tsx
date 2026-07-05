/**
 * ChartExplainer (#385) — the one-line "what am I looking at / when should I
 * worry" footer every supervision chart carries. Plain language for users
 * who aren't AI experts; keep it to one or two sentences.
 */
import type { ReactNode } from 'react'

export function ChartExplainer({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <span aria-hidden="true" className="mt-px select-none">ℹ</span>
      <span>{children}</span>
    </p>
  )
}
