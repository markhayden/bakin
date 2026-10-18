/**
 * budget component — spend limits are OPT-IN (spec S8): the out-of-box
 * posture is "recorded, not capped". check() is always ok and states the
 * fact. Nothing is ever installed — the Spend page (and `bakin budget set`)
 * is where a limit is chosen, ideally after Bakin has observed some history
 * to suggest one.
 */
import { readPluginSettings } from '../../../packages/core/src/plugins/settings-store'
import type { BudgetPolicy, BudgetRule } from '../budget'
import type { CheckOnlyComponent, CheckResult } from './types'

const SPEND_PLUGIN_ID = 'spend'

function currentRules(): BudgetRule[] {
  const settings = readPluginSettings<{ limits?: BudgetPolicy }>(SPEND_PLUGIN_ID)
  return settings.limits?.rules ?? []
}

async function checkBudget(): Promise<CheckResult> {
  // Limits are opt-in (spec S8): their absence is never a finding.
  const rules = currentRules()
  return {
    name: 'budget',
    status: 'ok',
    message: rules.length > 0
      ? `Spend limits configured — ${rules.length} rule${rules.length === 1 ? '' : 's'}.`
      : 'No spend limits set — spend is recorded; add a limit in Spend once you know what normal looks like.',
    details: { rules: rules.length },
  }
}

export const budgetComponent: CheckOnlyComponent = {
  // Limits are opt-in: the check is always ok, so there is nothing to set up.
  manualSetup: 'Set a limit in Spend (or `bakin budget set`) once you know what normal looks like.',
  name: 'budget',
  check: checkBudget,
}
