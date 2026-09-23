'use client'

import { DisclosurePanel } from '@makinbakin/sdk/layout'
import { ListRow, ListRows } from '@makinbakin/sdk/patterns'
import { Badge, Text } from '@makinbakin/sdk/ui'

import { budgetRuleLabel, formatRuleUnit } from './spend-utils'
import type { BudgetIncidentWire, BudgetMilestoneWire, BudgetRuleWire } from '../types'

interface PeriodRow {
  rule: BudgetRuleWire
  window: 'daily' | 'monthly'
  crossed: Array<{ milestone: number; acknowledged: boolean; spent: string; cap: string }>
  /** The cap incident speaks for 100. */
  atCap: BudgetIncidentWire | null
}

/**
 * What this period's ladder has recorded per rule and window — the 50/75/90
 * rows the status route serves (acknowledged or not) and the open cap
 * incident for 100. Pure over the page's data so the test can pin it.
 */
export function periodRows(rules: BudgetRuleWire[] | null, milestones: BudgetMilestoneWire[], incidents: BudgetIncidentWire[]): PeriodRow[] {
  const rows: PeriodRow[] = []
  for (const rule of rules ?? []) {
    if (!rule.id) continue
    for (const window of ['daily', 'monthly'] as const) {
      const cap = window === 'daily' ? rule.dailyCap : rule.monthlyCap
      if (cap === undefined) continue
      const crossed = milestones
        .filter((row) => row.ruleId === rule.id && row.window === window)
        .sort((a, b) => a.milestone - b.milestone)
        .map((row) => ({
          milestone: row.milestone,
          acknowledged: row.acknowledgedAt !== null,
          spent: formatRuleUnit(rule.lane, row.spentValue, row.unit === 'usd_micros'),
          cap: formatRuleUnit(rule.lane, row.capValue, row.unit === 'usd_micros'),
        }))
      const atCap = incidents.find((incident) =>
        incident.status !== 'resolved' && incident.window === window
        && incident.scope === rule.scope && incident.scopeId === (rule.scopeId ?? '') && incident.lane === rule.lane) ?? null
      rows.push({ rule, window, crossed, atCap })
    }
  }
  return rows
}

/** "This period's milestones" — the Limits tab's disclosure of what the ladder has already said this day/month. */
export function PeriodMilestones({
  rules,
  milestones,
  incidents,
}: {
  rules: BudgetRuleWire[] | null
  milestones: BudgetMilestoneWire[]
  incidents: BudgetIncidentWire[]
}) {
  const rows = periodRows(rules, milestones, incidents)
  const crossedCount = rows.reduce((n, row) => n + row.crossed.length + (row.atCap ? 1 : 0), 0)
  if (rows.length === 0) return null

  return (
    <DisclosurePanel
      summary="This period's milestones"
      summaryMeta={crossedCount === 0 ? 'none crossed' : `${crossedCount} crossed`}
      data-testid="period-milestones"
    >
      <ListRows aria-label="Milestones this period" variant="separated" columns="minmax(10rem,.6fr) minmax(0,1fr)" columnsAt="2xl">
        {rows.map((row) => (
          <ListRow key={`${row.rule.id}-${row.window}`} className="px-bakin-4 py-bakin-3">
            <Text size="body" className="font-bakin-typography-weight-semibold">
              {budgetRuleLabel(row.rule)} · {row.window}
            </Text>
            <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
              {row.crossed.length === 0 && !row.atCap ? (
                <Text size="meta" tone="muted">Nothing crossed yet this {row.window === 'daily' ? 'day' : 'month'}.</Text>
              ) : null}
              {row.crossed.map((step) => (
                <Badge
                  key={step.milestone}
                  variant="soft"
                  tone={step.acknowledged ? 'neutral' : 'attention'}
                  title={`${step.spent} of ${step.cap}${step.acknowledged ? ' · seen' : ' · not yet acknowledged'}`}
                >
                  {step.milestone}%{step.acknowledged ? '' : ' · new'}
                </Badge>
              ))}
              {row.atCap ? (
                <Badge variant="soft" tone="danger" title={`${formatRuleUnit(row.atCap.lane, row.atCap.spentValue, row.atCap.unit === 'usd_micros')} of ${formatRuleUnit(row.atCap.lane, row.atCap.capValue, row.atCap.unit === 'usd_micros')}`}>
                  100% · {row.atCap.atCap === 'pause' ? 'paused' : 'waiting'}
                </Badge>
              ) : null}
            </div>
          </ListRow>
        ))}
      </ListRows>
    </DisclosurePanel>
  )
}
