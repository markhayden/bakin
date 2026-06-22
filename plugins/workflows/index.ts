/**
 * Workflows plugin — template library + runtime engine.
 * Enforces step-by-step agent execution with gated delivery,
 * parallel steps, human gates, and output validation.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { listDefinitions, loadDefinition } from './lib/parser'
import { loadDefaultWorkflows } from './lib/load-defaults'
import {
  checkWorkflowDefinitions,
  checkStaleWorkflowInstances,
  checkWorkflowSkills,
  workflowSkillDriftRepair,
  staleWorkflowInstancesRepair,
} from './lib/health-checks'
import { getManagedDefinition } from './lib/source-registry'
import { listInstances, reconcilePendingApprovalTaskColumns } from './lib/runtime'
import { setWorkflowPluginContext } from './lib/plugin-context'
import { instanceToSearchDoc, definitionToSearchDoc } from './lib/search-sync'
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
import type { WorkflowDefinition, WorkflowInstance } from './types'

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
      { key: 'approvalChannel', type: 'string', label: 'Gate approval channel', description: 'Runtime channel ID for gate approval messages', default: 'general' },
      { key: 'requireRejectReason', type: 'boolean', label: 'Require reject reason', description: 'Require a reason when rejecting from a channel approval', default: true },
    ],
  },

  navItems: [
    { id: 'workflows', label: 'Workflows', icon: 'Workflow', href: '/workflows', order: 15 },
  ],

  contentFiles: [],

  async activate(ctx: PluginContext) {
    setWorkflowPluginContext(ctx)

    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerFileBackedContentType({
      table: 'workflows',
      schema: {
        name: { type: 'text' },
        description: { type: 'text' },
        type: { type: 'keyword' },
        status: { type: 'keyword' },
        task_id: { type: 'keyword' },
        steps: { type: 'text' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['name', 'description', 'steps'],
      rerankField: 'description',
      embeddingTemplate: '{{name}} {{description}} {{steps}}',
      facets: ['type', 'status'],
      filePatterns: [
        {
          pattern: 'workflows/definitions/*.{yaml,yml}',
          fileToId: (rel) => {
            const name = rel.replace(/^workflows\/definitions\//, '').replace(/\.(yaml|yml)$/, '')
            return `def:${name}`
          },
          fileToDoc: async (rel) => {
            const name = rel.replace(/^workflows\/definitions\//, '').replace(/\.(yaml|yml)$/, '')
            const def = loadDefinition(name)
            return def ? definitionToSearchDoc(name, def, def.source) : null
          },
        },
        {
          pattern: 'workflows/instances/*.json',
          fileToId: (rel) => {
            const taskId = rel.replace(/^workflows\/instances\//, '').replace(/\.json$/, '')
            return `inst:${taskId}`
          },
          fileToDoc: async (rel, content) => {
            try {
              const data = JSON.parse(content) as WorkflowInstance
              return instanceToSearchDoc(data)
            } catch {
              return null
            }
          },
        },
      ],
      preserveVirtualDocuments: true,
      onUnlink: async (rel) => {
        if (rel.startsWith('workflows/definitions/')) {
          const name = rel.replace(/^workflows\/definitions\//, '').replace(/\.(yaml|yml)$/, '')
          const defsDir = join(getContentDir(), 'workflows', 'definitions')
          const alternateUserPath = rel.endsWith('.yaml')
            ? join(defsDir, `${name}.yml`)
            : join(defsDir, `${name}.yaml`)

          if (existsSync(alternateUserPath)) {
            const alternateDefinition = yaml.load(readFileSync(alternateUserPath, 'utf-8')) as WorkflowDefinition
            await ctx.search.index(
              `def:${name}`,
              definitionToSearchDoc(name, { ...alternateDefinition, source: 'user' }, 'user'),
            )
            return
          }

          const fallbackEntry = getManagedDefinition(name)
          if (fallbackEntry) {
            await ctx.search.index(
              `def:${name}`,
              definitionToSearchDoc(
                name,
                { ...fallbackEntry.definition, source: fallbackEntry.source },
                fallbackEntry.source,
              ),
            )
          } else {
            await ctx.search.remove(`def:${name}`)
          }
          return
        }
        if (rel.startsWith('workflows/instances/')) {
          const taskId = rel.replace(/^workflows\/instances\//, '').replace(/\.json$/, '')
          await ctx.search.remove(`inst:${taskId}`)
        }
      },
      reindex: async function* () {
        const contentDir = getContentDir()

        // Yield effective definitions from every source: plugin defaults,
        // agent-package definitions, and user YAML shadows.
        for (const entry of listDefinitions(contentDir)) {
          yield { key: `def:${entry.name}`, doc: definitionToSearchDoc(entry.name, entry.definition, entry.source) }
        }

        // Yield instances
        const instancesDir = join(contentDir, 'workflows', 'instances')
        if (existsSync(instancesDir)) {
          for (const file of readdirSync(instancesDir).filter(f => f.endsWith('.json'))) {
            try {
              const data = JSON.parse(readFileSync(join(instancesDir, file), 'utf-8')) as WorkflowInstance
              yield { key: `inst:${data.taskId}`, doc: instanceToSearchDoc(data) }
            } catch { /* skip corrupt instances */ }
          }
        }
      },
      verifyExists: async (key: string) => {
        const contentDir = getContentDir()
        if (key.startsWith('def:')) {
          const name = key.slice(4)
          return loadDefinition(name, contentDir) !== null
        }
        if (key.startsWith('inst:')) {
          const taskId = key.slice(5)
          return existsSync(join(contentDir, 'workflows', 'instances', `${taskId}.json`))
        }
        return false
      },
    })

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
    ctx.registerHealthCheck({
      id: 'definitions',
      name: 'Workflow definition integrity',
      run: () => checkWorkflowDefinitions(getContentDir()),
    })
    ctx.registerHealthCheck({
      id: 'stale-instances',
      name: 'Stale workflow instances',
      run: () => checkStaleWorkflowInstances(getContentDir()),
      repair: staleWorkflowInstancesRepair(getContentDir()),
    })
    ctx.registerHealthCheck({
      id: 'skills',
      name: 'Workflow skills validation',
      run: async () => checkWorkflowSkills(getContentDir()),
      repair: workflowSkillDriftRepair(getContentDir()),
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
}) as unknown as BakinPlugin

export default workflowsPlugin
