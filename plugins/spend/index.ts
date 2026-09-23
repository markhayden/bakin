/**
 * Spend plugin — server entry point (the 14th core plugin, #907 initiative).
 *
 * "What it costs" lives here: observed + projected spend per billing lane,
 * the opt-in limits with fixed 50/75/90/100% milestones, billing-lane
 * overrides and pricing. "Which model" stays in the models plugin.
 *
 * Activation order matters: the one-shot settings upgrade (models.json
 * budget/billing → spend.json) runs BEFORE the spend.* hooks register, and
 * the dispatch gate fails closed while those hooks are absent — a crash
 * mid-upgrade never runs uncapped.
 */
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'
import { acceptUnattributedHistoryRepair, checkBudget, spendEvidenceRepair } from './lib/health-checks'
import { registerSpendHooks } from './lib/register-hooks'
import { spendRoutes } from './lib/routes'
import { describeSchemaIssues, SpendSettingsSchema } from './lib/settings'
import { upgradeSpendSettings } from './lib/settings-upgrade'

const log = createLogger('spend')

const spendPlugin: BakinPlugin = definePlugin({
  id: 'spend',
  name: 'Spend',
  version: '1.0.0',
  routes: spendRoutes,

  // The generic PUT /api/plugin-settings/spend must not become a side door
  // that leaves an invalid policy on disk (which would fail dispatch closed).
  validateSettings(value: unknown) {
    const parsed = SpendSettingsSchema.safeParse(value)
    return parsed.success ? { ok: true } : { ok: false, error: `not a valid spend policy: ${describeSchemaIssues(parsed.error).join('; ')}` }
  },

  activate(ctx: PluginContext) {
    const upgrade = upgradeSpendSettings()
    // A blocked upgrade leaves the operator's bytes untouched; the hooks
    // still register so every read names the exact file (fail closed with
    // a reason, not a silent "no limits").
    if (upgrade.status === 'blocked') log.error('spend settings upgrade blocked — dispatch fails closed until the file is fixed', undefined, { reason: upgrade.reason })
    else if (upgrade.status !== 'noop') log.info('spend settings', upgrade)

    registerSpendHooks(ctx)

    ctx.registerHealthCheck({
      id: 'budget',
      name: 'Spend vs budget caps',
      description: 'Evaluates spending policy, open holds, and current usage against every budget rule.',
      group: { key: 'work-cost', label: 'Work & Cost' },
      maxAgeMs: 120_000,
      run: () => checkBudget(),
    })
    ctx.registerHealthRepairAction(spendEvidenceRepair())
    ctx.registerHealthRepairAction(acceptUnattributedHistoryRepair())
  },
})

export default spendPlugin
