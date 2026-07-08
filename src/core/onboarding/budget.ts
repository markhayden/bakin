/**
 * budget component — makes the out-of-box posture "aware, not capped":
 * onboarding PROMPTS for a spending budget (skippable; no default caps are
 * ever written silently — spec V2), and while no cap rule exists the budget
 * health check keeps a standing "spend is uncapped" notice.
 *
 * check(): ok when the models-plugin budget policy has ≥1 cap rule; warn
 * otherwise. install(): interactive prompt for global metered daily/monthly
 * USD caps, written to the models plugin settings (the same storage the
 * Spend tab edits). `--yes` skips with a printed warning — an explicit
 * decision to run uncapped, not a silent default.
 */
import { readPluginSettings, mergePluginSettings } from '../../../packages/core/src/plugins/settings-store'
import type { BudgetPolicy, BudgetRule } from '../budget'
import { createLogger } from '../logger'
import { readLine, askYesNo } from './prompts'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:budget')

const MODELS_PLUGIN_ID = 'models'

function currentRules(): BudgetRule[] {
  const settings = readPluginSettings<{ budget?: BudgetPolicy }>(MODELS_PLUGIN_ID)
  return settings.budget?.rules ?? []
}

async function checkBudget(): Promise<CheckResult> {
  try {
    const rules = currentRules()
    if (rules.length > 0) {
      return {
        name: 'budget',
        status: 'ok',
        message: `Budget configured — ${rules.length} cap rule${rules.length === 1 ? '' : 's'}.`,
        details: { rules: rules.length },
      }
    }
    return {
      name: 'budget',
      status: 'warn',
      message: 'No spending budget is set — agent spend is uncapped.',
      remediation: 'Set a budget in Models → Spend, or run `bakin budget set --scope global --lane metered --daily <usd>`.',
    }
  } catch (err) {
    log.warn('Budget check failed', err)
    return {
      name: 'budget',
      status: 'warn',
      message: `Could not read the budget policy: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Set a budget in Models → Spend once the server is up.',
    }
  }
}

async function askUsd(prompt: string): Promise<number | null> {
  const raw = await readLine(prompt)
  if (raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    console.log('  (not a positive number — leaving this cap unset)')
    return null
  }
  return value
}

async function installBudget(opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  if (currentRules().length > 0) {
    return { name: 'budget', status: 'noop', message: 'Budget already configured.', durationMs: Date.now() - start }
  }
  if (!opts.interactive || opts.autoApprove) {
    // --yes / non-TTY: never invent a cap. Loud, explicit skip.
    console.log('  ⚠ No spending budget set — agent spend is UNCAPPED until you set one (Models → Spend or `bakin budget set`).')
    return { name: 'budget', status: 'skipped', message: 'Skipped (non-interactive) — spend is uncapped until a budget is set.', durationMs: Date.now() - start }
  }

  const wantsBudget = await askYesNo('Set a spending budget now? (protects against runaway agent spend)', true)
  if (!wantsBudget) {
    console.log('  ⚠ Skipping — spend is UNCAPPED until you set a budget (Models → Spend).')
    return { name: 'budget', status: 'skipped', message: 'Declined — spend is uncapped until a budget is set.', durationMs: Date.now() - start }
  }

  const dailyCap = await askUsd('Daily cap in USD (e.g. 25; Enter to skip):')
  const monthlyCap = await askUsd('Monthly cap in USD (e.g. 300; Enter to skip):')
  if (dailyCap === null && monthlyCap === null) {
    console.log('  ⚠ No caps entered — spend is UNCAPPED until you set a budget.')
    return { name: 'budget', status: 'skipped', message: 'No caps entered — spend is uncapped.', durationMs: Date.now() - start }
  }

  try {
    const rule: BudgetRule = {
      scope: 'global',
      lane: 'metered',
      ...(dailyCap !== null ? { dailyCap } : {}),
      ...(monthlyCap !== null ? { monthlyCap } : {}),
    }
    mergePluginSettings(MODELS_PLUGIN_ID, { budget: { rules: [rule] } })
    const caps = [dailyCap !== null ? `$${dailyCap}/day` : null, monthlyCap !== null ? `$${monthlyCap}/month` : null].filter(Boolean).join(', ')
    return { name: 'budget', status: 'installed', message: `Global metered budget set (${caps}). Warn at 80%, defer at 100%.`, durationMs: Date.now() - start }
  } catch (err) {
    return { name: 'budget', status: 'failed', message: `Failed to write the budget policy: ${err instanceof Error ? err.message : String(err)}`, error: err, durationMs: Date.now() - start }
  }
}

export const budgetComponent: OnboardingComponent = {
  name: 'budget',
  check: checkBudget,
  install: installBudget,
}
