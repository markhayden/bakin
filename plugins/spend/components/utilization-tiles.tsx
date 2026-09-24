'use client'

import { Grid } from '@makinbakin/sdk/layout'
import { StatTile } from '@makinbakin/sdk/patterns'

import { budgetRuleLabel, budgetRuleSpend, formatResetsIn, formatRuleUnit } from './spend-utils'
import type { BudgetRuleWire, SpendResponse } from '../types'

export function utilizationTone(percent: number): 'success' | 'attention' | 'danger' {
  if (percent >= 100) return 'danger'
  if (percent >= 80) return 'attention'
  return 'success'
}

/**
 * One tile per capped window of every rule: percent of the cap used on
 * current spend, spent of cap, and — where the page knows the window's end
 * — when it resets. Overview and Limits render the same tiles (Limits with
 * the reset), so a number the operator saw on one tab is the number on the
 * other.
 */
export function UtilizationTiles({
  rules,
  spend,
  resets = false,
  now = Date.now(),
}: {
  rules: BudgetRuleWire[]
  spend: SpendResponse
  /** Append "resets in …" from the pace windows (Limits tab). */
  resets?: boolean
  now?: number
}) {
  if (!spend.facets) return null

  const tiles = rules.flatMap((rule) => (
    (['daily', 'monthly'] as const).flatMap((windowName) => {
      const configuredCap = windowName === 'daily' ? rule.dailyCap : rule.monthlyCap
      if (!configuredCap) return []
      const cap = rule.lane === 'metered' ? configuredCap * 1_000_000 : configuredCap
      const spent = budgetRuleSpend(rule, spend.facets![windowName])
      const percent = cap > 0 ? (spent / cap) * 100 : 0
      const endsMs = spend.pace?.[windowName]?.endsMs
      const reset = resets && endsMs !== undefined ? ` · ${formatResetsIn(endsMs, now)}` : ''
      return [{
        id: `${budgetRuleLabel(rule)}-${windowName}`,
        label: `${budgetRuleLabel(rule)} · ${windowName}`,
        value: `${Math.round(percent)}%`,
        sub: `${formatRuleUnit(rule.lane, spent, rule.lane === 'metered')} of ${formatRuleUnit(rule.lane, cap, rule.lane === 'metered')}${reset}`,
        percent,
      }]
    })
  ))

  if (tiles.length === 0) return null

  return (
    <Grid layout="auto-fill" gap="dense" role="group" aria-label="Budget utilization">
      {tiles.map((tile) => (
        <StatTile
          key={tile.id}
          variant="surface"
          label={tile.label}
          value={tile.value}
          valueTone={utilizationTone(tile.percent)}
          sub={tile.sub}
          progress={{
            percent: tile.percent,
            tone: utilizationTone(tile.percent),
            label: `${tile.label} utilization`,
          }}
        />
      ))}
    </Grid>
  )
}
