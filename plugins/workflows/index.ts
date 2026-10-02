/**
 * Workflows plugin — template library + runtime engine.
 * Enforces step-by-step agent execution with gated delivery,
 * parallel steps, human gates, and output validation.
 */
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { listDefinitions } from './lib/parser'
import { loadDefaultWorkflowFiles } from './lib/load-defaults'
import {
  checkWorkflowDefinitions,
  checkStaleWorkflowInstances,
  checkWorkflowSkills,
  workflowSkillDriftRepair,
  staleWorkflowInstancesRepair,
} from './lib/health-checks'
import { listInstances, reconcilePendingApprovalTaskColumns } from './lib/runtime'
import { setWorkflowPluginContext } from './lib/plugin-context'
import { registerWorkflowSearch } from './lib/search-sync'
import { definitionRoutes } from './lib/routes/definitions'
import { instanceRoutes } from './lib/routes/instances'
import { gateRoutes } from './lib/routes/gates'
import { registerWorkflowExecTools } from './lib/exec-tools'
import { registerWorkflowHooks } from './lib/register-hooks'
import { ensurePendingGateApprovals, registerWorkflowGateApprovalKind } from './lib/approval-kind'
import { createLogger } from '../../src/core/logger'
import { getContentDir } from '../../src/core/content-dir'
import { pluginRootFromModuleUrl, shippedWorkflowFiles } from '../../src/core/plugin-resources'
import { checkShippedDefaults, recordShippedDefaults } from './lib/shipped-defaults'
import { setEventBus, setNotificationRuntime } from './lib/notifications'

const log = createLogger('workflows')

const workflowsPlugin: BakinPlugin = definePlugin({
  routes: [...definitionRoutes, ...instanceRoutes, ...gateRoutes] as unknown as Parameters<typeof definePlugin>[0]['routes'],
  id: 'workflows',
  name: 'Workflows',
  version: '2.2.0',

  settingsSchema: {
    fields: [
      { key: 'gateTimeout', type: 'number', label: 'Gate timeout (hours)', description: 'Auto-reject gates not approved within this time', default: 24 },
      { key: 'maxConcurrentSteps', type: 'number', label: 'Max concurrent steps', description: 'Maximum steps running in parallel per workflow', default: 3 },
    ],
  },

  navItems: [
    { id: 'workflows', label: 'Workflows', icon: 'Workflow', href: '/workflows', order: 15 },
  ],

  contentFiles: [],

  async activate(ctx: PluginContext) {
    setWorkflowPluginContext(ctx)

    // ─── Search Content Type Registration ─────────────────────────────
    registerWorkflowSearch(ctx)

    // ─── Plugin-shipped workflow defaults ─────────────────────────────
    // Load every YAML in defaults/workflows/ and register through
    // ctx.registerWorkflow so disk-resident user copies still win.
    // Resolved through plugin-resources: disk on a checkout, the embedded
    // copies inside a compiled binary (where this module has no directory).
    const pluginRoot = pluginRootFromModuleUrl(import.meta.url)
    const shipped = shippedWorkflowFiles('workflows', pluginRoot)
    const defaultsLoaded = loadDefaultWorkflowFiles(ctx, shipped, log)
    recordShippedDefaults({ files: shipped, pluginPath: pluginRoot, ...defaultsLoaded })
    if (defaultsLoaded.registered.length > 0) {
      log.info(`Registered ${defaultsLoaded.registered.length} plugin-shipped workflow(s)`, {
        ids: defaultsLoaded.registered,
      })
    }

    // Wire up notification services.
    setEventBus(ctx.events)
    setNotificationRuntime(ctx.runtime)

    // Gates are approvals (spec D6): core owns the record, rehydration and the
    // channel subscription; this plugin owns what a gate decision means.
    // Approval settings live in settings.approvals, not here.
    registerWorkflowGateApprovalKind()

    registerWorkflowHooks(ctx)

    // ─── Health checks (migrated out of core/doctor.ts per #137) ─────
    ctx.registerHealthRepairAction(staleWorkflowInstancesRepair(getContentDir()))
    ctx.registerHealthRepairAction(workflowSkillDriftRepair(getContentDir()))
    ctx.registerHealthCheck({
      id: 'definitions',
      name: 'Workflow definition integrity',
      description: 'Checks workflow schemas and every skill or nested-workflow reference.',
      group: { key: 'workflows', label: 'Workflows' },
      maxAgeMs: 5 * 60_000,
      run: () => checkWorkflowDefinitions(getContentDir()),
    })
    ctx.registerHealthCheck({
      id: 'shipped-defaults',
      name: 'Shipped workflow defaults',
      description: 'Verifies this build can locate and register the workflows the plugin ships.',
      group: { key: 'workflows', label: 'Workflows' },
      maxAgeMs: 10 * 60_000,
      run: async () => checkShippedDefaults(),
    })
    ctx.registerHealthCheck({
      id: 'stale-instances',
      name: 'Stale workflow instances',
      description: 'Finds workflow instances that are stalled or belong to deleted tasks.',
      group: { key: 'workflows', label: 'Workflows' },
      maxAgeMs: 2 * 60_000,
      run: () => checkStaleWorkflowInstances(getContentDir()),
    })
    ctx.registerHealthCheck({
      id: 'skills',
      name: 'Workflow skills validation',
      description: 'Checks workflow skill metadata and managed-source drift.',
      group: { key: 'workflows', label: 'Workflows' },
      maxAgeMs: 5 * 60_000,
      run: async () => checkWorkflowSkills(getContentDir()),
    })

    // ─── MCP Exec Tools ────────────────────────────────────────────────
    registerWorkflowExecTools(ctx)
  },

  onReady() {
    const instances = listInstances()
    const active = instances.filter(i => i.status === 'in_progress')
    if (active.length > 0) {
      log.info(`Ready — ${active.length} active workflow instance(s)`)
    }
    // Every gate waiting on a decision has a pending record before the board
    // reads them (plan review R5a). Runs before core's rehydration/channel
    // wiring, which happens after every plugin is ready.
    try {
      const ensured = ensurePendingGateApprovals()
      if (ensured.created > 0) log.info(`Recorded ${ensured.created} pending gate approval(s) that had no record`, ensured)
    } catch (err) {
      log.error('Pending gate approval reconciliation failed', err)
    }
    reconcilePendingApprovalTaskColumns()
      .then((result) => {
        if (result.moved > 0) {
          log.info(`Reconciled ${result.moved} pending approval workflow task card(s)`, {
            checked: result.checked,
            skipped: result.skipped,
          })
        }
        if (result.failed.length > 0) {
          log.warn('Pending approval workflow task reconciliation had failures', {
            failed: result.failed,
          })
        }
      })
      .catch((err) => {
        log.warn('Pending approval workflow task reconciliation failed', err)
      })
    const defs = listDefinitions()
    log.info(`Ready — ${defs.length} workflow definition(s) loaded`)
  },

  onShutdown() {
    const active = listInstances().filter(i => i.status === 'in_progress')
    if (active.length > 0) {
      log.warn(`Shutting down with ${active.length} active workflow instance(s)`)
    }
  },
})

export default workflowsPlugin
