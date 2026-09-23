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
import { upgradeSpendSettings } from './lib/settings-upgrade'

const log = createLogger('spend')

const spendPlugin: BakinPlugin = definePlugin({
  id: 'spend',
  name: 'Spend',
  version: '1.0.0',
  routes: spendRoutes,

  activate(ctx: PluginContext) {
    const upgrade = upgradeSpendSettings()
    if (upgrade.status !== 'noop') log.info('spend settings', upgrade)

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
