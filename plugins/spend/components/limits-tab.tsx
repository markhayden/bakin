'use client'

import { BillingLanesSection, BudgetRulesSection } from './spend-budget-controls'
import type { SpendData } from './use-spend-data'

/** Limits: the cap-rule editor and the per-agent billing-lane overrides. */
export function LimitsTab({ m }: { m: SpendData }) {
  return (
    <div className="flex min-w-0 flex-col gap-bakin-8">
      <BudgetRulesSection m={m} />
      <BillingLanesSection m={m} />
    </div>
  )
}
