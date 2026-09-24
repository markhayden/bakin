'use client'

import { useState } from 'react'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { Text } from '@makinbakin/sdk/ui'

import { LimitDialog, type LimitDraft } from './limit-dialog'
import { PeriodMilestones } from './period-milestones'
import { BillingLanesSection, BudgetRulesSection } from './spend-budget-controls'
import type { SpendData } from './use-spend-data'
import { UtilizationTiles } from './utilization-tiles'

/**
 * Where every saved rule stands right now: the same utilization tiles the
 * Overview shows, with when each window resets, and the ladder rows this
 * period has already recorded. Shown only once there are rules to stand.
 */
function CurrentPeriodSection({ m }: { m: SpendData }) {
  const rules = m.budgetRules
  if (!rules || rules.length === 0) return null
  return (
    <Section spacing="compact" aria-label="Current period" data-testid="current-period">
      <Stack gap="dense">
        <h2>Current period</h2>
        <Text size="body" tone="muted" as="p" className="max-w-prose leading-relaxed">
          How much of each limit is used so far, and when its window resets.
        </Text>
      </Stack>
      {m.spend?.facets ? (
        <UtilizationTiles rules={rules} spend={m.spend} resets />
      ) : (
        <Text size="meta" tone="muted">Current spend is unavailable, so utilization cannot be shown.</Text>
      )}
      <PeriodMilestones rules={rules} milestones={m.budgetStatus?.milestones ?? []} incidents={m.incidents} />
    </Section>
  )
}

/** Limits: where the rules stand this period, the guided "Add a limit" dialog, the rule editor, and the per-agent billing-lane overrides. */
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
      <CurrentPeriodSection m={m} />
      <BudgetRulesSection m={m} onAddLimit={() => { setDialogError(null); setDialogOpen(true) }} />
      <BillingLanesSection m={m} />
      <LimitDialog open={dialogOpen} onOpenChange={setDialogOpen} onSave={saveLimit} saving={dialogSaving} error={dialogError} agents={m.agents} providers={m.availableProviders} />
    </div>
  )
}
