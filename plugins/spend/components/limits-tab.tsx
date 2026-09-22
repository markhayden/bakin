'use client'

import { useState } from 'react'

import { LimitDialog, type LimitDraft } from './limit-dialog'
import { BillingLanesSection, BudgetRulesSection } from './spend-budget-controls'
import type { SpendData } from './use-spend-data'

/** Limits: the guided "Add a limit" dialog, the rule editor, and the per-agent billing-lane overrides. */
export function LimitsTab({ m }: { m: SpendData }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [dialogSaving, setDialogSaving] = useState(false)

  const saveLimit = async (draft: LimitDraft) => {
    setDialogSaving(true)
    setDialogError(null)
    try {
      const outcome = await m.addLimit(draft)
      if (outcome.ok) setDialogOpen(false)
      else setDialogError(outcome.error)
    } finally {
      setDialogSaving(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-bakin-8">
      <BudgetRulesSection m={m} onAddLimit={() => { setDialogError(null); setDialogOpen(true) }} />
      <BillingLanesSection m={m} />
      <LimitDialog open={dialogOpen} onOpenChange={setDialogOpen} onSave={saveLimit} saving={dialogSaving} error={dialogError} />
    </div>
  )
}
