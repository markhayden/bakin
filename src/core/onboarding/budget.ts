/**
 * budget component — spend limits are OPT-IN (spec S8): the out-of-box
 * posture is "recorded, not capped". check() is always ok and states the
 * fact; install() prints one informational line and never prompts or
 * writes — the Spend page (and `bakin budget set`) is where a limit is
 * chosen, ideally after Bakin has observed some history to suggest one.
 */
import { readPluginSettings } from '../../../packages/core/src/plugins/settings-store'
import type { BudgetPolicy, BudgetRule } from '../budget'
import type { CheckResult, InstallResult, OnboardingComponent } from './types'

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

async function installBudget(): Promise<InstallResult> {
  const start = Date.now()
  const rules = currentRules()
  if (rules.length > 0) {
    return { name: 'budget', status: 'noop', message: 'Spend limits already configured.', durationMs: Date.now() - start }
  }
  // One line, no prompt, no warning: Bakin records everything from day one
  // and the Spend page suggests a limit from observed history (D27).
  console.log('  ℹ Spend limits are off. Bakin records every turn; set a limit in Spend (or `bakin budget set`) once you know what normal looks like.')
  return { name: 'budget', status: 'noop', message: 'Spend limits are opt-in — none set.', durationMs: Date.now() - start }
}

export const budgetComponent: OnboardingComponent = {
  name: 'budget',
  check: checkBudget,
  install: installBudget,
}
