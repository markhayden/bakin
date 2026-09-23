/**
 * Models plugin — server entry point.
 * Routes for the model catalog, the ONE selections write path, the plan,
 * and runtime restart; the health checks and repairs that keep every
 * persisted model selection honest.
 *
 * Thin definePlugin shell: the route array lives in lib/routes.ts, the
 * cross-plugin hooks in lib/register-hooks.ts, the exec tools in
 * lib/exec-tools.ts, and the config/cache/alias machinery in
 * lib/{config-io,available-models,aliases,model-id,route-schemas}.ts.
 */
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'

import { modelsRoutes } from './lib/routes'
import { registerModelsHooks } from './lib/register-hooks'
import { registerModelsExecTools } from './lib/exec-tools'
import { isLegacyRouting, migrateLegacyRouting } from '../../src/core/routing-migration'
import { buildRoutingHealthDeps, checkModelRouting, recommendedRoutesRepair } from './lib/health-checks'
import { checkDeadSelections, deadSelectionRepair } from './lib/dead-selections'
import { applySelections, describeSelections, getSelectionMutator, readRoutingSettings } from './lib/selections'
import { currentPlan } from './lib/plan'
import { listRunCostsSince } from '../../src/core/execution-ledger'
import type { ModelsPluginSettings } from './types'

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
const modelsPlugin: BakinPlugin = definePlugin({
  id: 'models',
  name: 'Models',
  version: '3.0.0',
  routes: modelsRoutes,

  // Nav items registered in client.tsx (order: 70) — no server-side duplication

  activate(ctx: PluginContext) {
    // One-shot routing-shape migration (origin policies → work-class routes).
    // Same discipline: runs before hooks register so models.getRoutingConfig
    // never serves the legacy shape.
    const routing = ctx.getSettings<ModelsPluginSettings>().routing
    if (isLegacyRouting(routing)) {
      ctx.updateSettings({ routing: migrateLegacyRouting(routing) })
    }

    // Hooks — cross-plugin communication
    registerModelsHooks(ctx)

    // MCP Exec Tools — read-only agent access
    registerModelsExecTools(ctx)

    // models.routing health check + apply-recommended repair (repair first —
    // the check's resolution references its actionId).
    const routingDeps = buildRoutingHealthDeps(ctx, {
      readRoutingConfig: () => readRoutingSettings(ctx).routing,
      // currentPlan remembers the plan for refused-write proposals too.
      recommendPlan: () => currentPlan(ctx),
      listRunCostsSince: (sinceMs) => listRunCostsSince(sinceMs),
    })
    ctx.registerHealthRepairAction(recommendedRoutesRepair(routingDeps, async (newRoutes) => {
      // Through the ONE write path (#907) — never a direct settings write.
      const { revision } = await getSelectionMutator(ctx).reconcile()
      await applySelections(ctx, { revision, ops: newRoutes.map((r) => ({ ref: `route:${r.workClass}`, set: { model: r.model ?? null } })) })
    }))
    // models.dead-selections: one finding per persisted selection that cannot
    // run, with a one-click repair applying EXACTLY the displayed proposal.
    const deadDeps = {
      describe: () => describeSelections(ctx),
      // ONE mutation under the batch's shared revision (every proposal of a plan carries the same one), through applySelections so the post-write side effects run.
      apply: (proposals: Array<{ ref: string; to: string | null; revision: string }>) =>
        applySelections(ctx, { revision: proposals[0]!.revision, ops: proposals.map((p) => ({ ref: p.ref, set: { model: p.to } })) }),
    }
    ctx.registerHealthRepairAction(deadSelectionRepair(deadDeps))
    ctx.registerHealthCheck({
      id: 'dead-selections',
      name: 'Model selections that cannot run',
      description: 'Every persisted model selection (agent pins, work-class routes, tag overrides, runtime defaults) whose model has no credentials, was rejected by the account, or is gone from the catalog — each with a proposed repair.',
      group: { key: 'models', label: 'Models' },
      maxAgeMs: 60_000,
      run: () => checkDeadSelections(deadDeps),
    })

    ctx.registerHealthCheck({
      id: 'routing',
      name: 'Work-class model routing',
      description: 'Flags unrouted system classes, clamping thinking levels, and premium models on cheap work. (Routes to models that cannot run are the dead-selections check.)',
      group: { key: 'models', label: 'Models' },
      maxAgeMs: 60_000,
      run: () => checkModelRouting(routingDeps),
    })
  },
})

export default modelsPlugin
