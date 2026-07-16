/**
 * Workflows plugin — template library + runtime engine.
 * Enforces step-by-step agent execution with gated delivery,
 * parallel steps, human gates, and output validation.
 */
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { listDefinitions } from './lib/parser'
import { loadDefaultWorkflows } from './lib/load-defaults'
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
import { setGateSettings } from './lib/gate-settings'
import { registerWorkflowExecTools } from './lib/exec-tools'
import { registerWorkflowHooks } from './lib/register-hooks'
import { wireChannelApprovals } from './lib/channel-approvals'
import { createLogger } from '../../src/core/logger'
import { getContentDir } from '../../src/core/content-dir'
import {
  setEventBus,
  setGateNotificationSettings,
  setNotificationRuntime,
  type GateNotificationSettings,
} from './lib/notifications'

const log = createLogger('workflows')
let unsubscribeApprovalResponses: (() => void) | null = null

const workflowsPlugin: BakinPlugin = definePlugin({
  routes: [...definitionRoutes, ...instanceRoutes, ...gateRoutes] as unknown as Parameters<typeof definePlugin>[0]['routes'],
  id: 'workflows',
  name: 'Workflows',
  version: '2.0.0',

  settingsSchema: {
    fields: [
      { key: 'gateTimeout', type: 'number', label: 'Gate timeout (hours)', description: 'Auto-reject gates not approved within this time', default: 24 },
      { key: 'maxConcurrentSteps', type: 'number', label: 'Max concurrent steps', description: 'Maximum steps running in parallel per workflow', default: 3 },
      { key: 'notifyOnGate', type: 'boolean', label: 'Notify on gate', description: 'Send notification when a gate needs approval', default: true },
      { key: 'approvalChannelAlerts', type: 'boolean', label: 'Channel gate alerts', description: 'Send runtime channel approvals when gates need review', default: false },
      { key: 'approvalChannel', type: 'string', label: 'Gate approval channel', description: 'Runtime channel id or notifications.channelAliases alias for gate approval messages', default: 'general' },
      { key: 'requireRejectReason', type: 'boolean', label: 'Require reject reason', description: 'Require a typed reason in the Bakin UI and fallback page; channel button rejects record a default reason', default: true },
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
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    const defaultsDir = join(moduleDir, 'defaults', 'workflows')
    const defaultsLoaded = loadDefaultWorkflows(ctx, defaultsDir, log)
    if (defaultsLoaded.registered.length > 0) {
      log.info(`Registered ${defaultsLoaded.registered.length} plugin-shipped workflow(s)`, {
        ids: defaultsLoaded.registered,
      })
    }

    // Wire up notification services.
    setEventBus(ctx.events)
    setNotificationRuntime(ctx.runtime)

    const pluginSettings = ctx.getSettings<Record<string, unknown>>()
    const initialGateSettings: GateNotificationSettings = {
      approvalChannelAlerts: pluginSettings.approvalChannelAlerts as boolean ?? false,
      approvalChannel: pluginSettings.approvalChannel as string ?? 'general',
      requireRejectReason: pluginSettings.requireRejectReason as boolean ?? true,
    }
    setGateSettings(initialGateSettings)
    setGateNotificationSettings(initialGateSettings)

    unsubscribeApprovalResponses?.()
    unsubscribeApprovalResponses = await wireChannelApprovals(ctx)

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

  async onSettingsChange(newSettings: Record<string, unknown>) {
    const updated: GateNotificationSettings = {
      approvalChannelAlerts: newSettings.approvalChannelAlerts as boolean ?? false,
      approvalChannel: newSettings.approvalChannel as string ?? 'general',
      requireRejectReason: newSettings.requireRejectReason as boolean ?? true,
    }
    setGateNotificationSettings(updated)
  },

  onShutdown() {
    unsubscribeApprovalResponses?.()
    unsubscribeApprovalResponses = null
    const active = listInstances().filter(i => i.status === 'in_progress')
    if (active.length > 0) {
      log.warn(`Shutting down with ${active.length} active workflow instance(s)`)
    }
  },
})

export default workflowsPlugin
