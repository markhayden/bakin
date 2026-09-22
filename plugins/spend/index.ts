/**
 * Spend plugin — server entry point (the 14th core plugin, #907 initiative).
 *
 * "What it costs" lives here: observed + projected spend per billing lane,
 * the opt-in limits with fixed 50/75/90/100% milestones, billing-lane
 * overrides and pricing. "Which model" stays in the models plugin. Today
 * this registers the page slot and the spend health check + repairs; the
 * routes, hooks and settings upgrade arrive with the ownership cutover
 * (T2.7) as ONE commit so no intermediate state has two writable policy
 * stores.
 */
import type { BakinPlugin } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { acceptUnattributedHistoryRepair, checkBudget, spendEvidenceRepair } from './lib/health-checks'

const spendPlugin: BakinPlugin = definePlugin({
  id: 'spend',
  name: 'Spend',
  version: '0.1.0',
  routes: [],

  activate(ctx) {
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
