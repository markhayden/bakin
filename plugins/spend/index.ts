/**
 * Spend plugin — server entry point (the 14th core plugin, #907 initiative).
 *
 * "What it costs" lives here: observed + projected spend per billing lane,
 * the opt-in limits with fixed 50/75/90/100% milestones, billing-lane
 * overrides and pricing. "Which model" stays in the models plugin. This
 * scaffold contributes the page slot only; routes, hooks and the settings
 * upgrade arrive with the ownership cutover (T2.7) as ONE commit so no
 * intermediate state has two writable policy stores.
 */
import type { BakinPlugin } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'

const spendPlugin: BakinPlugin = definePlugin({
  id: 'spend',
  name: 'Spend',
  version: '0.1.0',
  routes: [],
  activate() {},
})

export default spendPlugin
