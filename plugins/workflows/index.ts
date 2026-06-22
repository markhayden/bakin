/**
 * Workflows plugin — template library + runtime engine.
 * Enforces step-by-step agent execution with gated delivery,
 * parallel steps, human gates, and output validation.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { z } from 'zod'
import type { ApprovalActor, BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { listDefinitions, loadDefinition } from './lib/parser'
import { workflowDefinitionNameFromHookInput } from './lib/hook-input'
import { loadDefaultWorkflows } from './lib/load-defaults'
import {
  getNotificationChannel,
  listNotificationChannels,
} from './lib/notification-channel-registry'
import {
  checkWorkflowDefinitions,
  checkStaleWorkflowInstances,
  checkWorkflowSkills,
  workflowSkillDriftRepair,
  staleWorkflowInstancesRepair,
} from './lib/health-checks'
import {
  getManagedDefinition,
} from './lib/source-registry'
import {
  loadInstance,
  saveInstance,
  getCurrentStep,
  completeStep,
  approveGate,
  rejectGate,
  reopenFromStep,
  listInstances,
  getActiveAgents,
  authorizeWorkflowToolUse,
  reconcilePendingApprovalTaskColumns,
  isGateNotified,
  markGateNotified,
  cancelInstance,
  type WorkflowToolUseAction,
} from './lib/runtime'
import { matchWorkflow } from './lib/matcher'
import {
  buildTemplateList,
  resolveSubWorkflows,
} from './lib/template-list'
import { formatStepContext } from './lib/step-format'
import { createValidatedInstance } from './lib/start-validation'
import { setWorkflowPluginContext } from './lib/plugin-context'
import { instanceToSearchDoc, definitionToSearchDoc, indexInstance } from './lib/search-sync'
import { definitionRoutes } from './lib/routes/definitions'
import { instanceRoutes } from './lib/routes/instances'
import { gateRoutes } from './lib/routes/gates'
import { triggerDispatch } from './lib/trigger-dispatch'
import { setGateSettings, activeGateSettings } from './lib/gate-settings'
import { getGateDescription, buildGateAuditPayload } from './lib/gate-audit'
import { createLogger } from '../../src/core/logger'
import { getContentDir } from '../../src/core/content-dir'
import { getTask, updateTask } from '../../src/core/task-store'
import { validateStepOutput } from './lib/schema-validator'
import {
  resolveGateApproval,
  sendGateDecisionSummary,
  setEventBus,
  setGateNotificationSettings,
  setNotificationRuntime,
  type GateNotificationSettings,
} from './lib/notifications'
import { approvalRefFromRecord, getApprovalRecord } from './lib/approval-store'
import { rehydratePendingApprovals } from './lib/approval-rehydration'
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

    const approvalRehydration = await rehydratePendingApprovals({
      runtime: ctx.runtime,
      channel: activeGateSettings().approvalChannel || 'general',
      renderMissingDeliveries: activeGateSettings().approvalChannelAlerts,
      log,
    })
    if (approvalRehydration.pending > 0) {
      log.info('Rehydrated pending workflow approvals', { ...approvalRehydration })
    }

    unsubscribeApprovalResponses?.()
    unsubscribeApprovalResponses = ctx.runtime.channels.subscribeApprovalResponses(async (event) => {
      const approvalRecord = getApprovalRecord(event.approvalId)
      if (!approvalRecord) {
        log.warn('Channel approval response ignored: no durable approval record', { approvalId: event.approvalId })
        return
      }

      const taskId = approvalRecord.owner.taskId
      const stepId = approvalRecord.owner.stepId
      if (!taskId || !stepId) return
      const approver: ApprovalActor = {
        source: 'channel',
        id: event.response.actor.id,
        displayName: event.response.actor.displayName,
      }
      const selected = event.response.selectedOption

      if (selected === 'approve') {
        const approvalRef = approvalRefFromRecord(approvalRecord)
        const result = approveGate(taskId, stepId, { approver })
        if (!result.success) {
          log.warn(`Channel approve failed: ${result.errors?.[0] || 'unknown error'}`, { taskId, stepId })
          return
        }

        const auditPayload = buildGateAuditPayload(taskId, stepId, result.decision)
        ctx.activity.audit('gate.approved', 'channel', auditPayload)
        ctx.activity.log('channel', `Gate "${stepId}" approved via runtime channel`, { taskId })
        indexInstance(taskId).catch(() => {})
        triggerDispatch()

        const instance = loadInstance(taskId)
        if (instance && result.decision) {
          resolveGateApproval(
            approvalRef,
            'approved',
            approver,
            result.decision.decidedAt,
          ).catch(() => {})
          sendGateDecisionSummary(
            instance,
            stepId,
            result.decision.gateLabel,
            getGateDescription(instance.workflowId, stepId),
            'approved',
            approver,
            result.decision.requestedAt,
            result.decision.decidedAt,
            undefined,
            activeGateSettings(),
          ).catch(() => {})
        }
      } else if (selected === 'reject') {
        const channelComment = event.response.comment?.trim()
        const requiresRejectReason = approvalRecord.request.context?.requireRejectReason === true
        if (requiresRejectReason && !channelComment) {
          log.warn('Channel reject ignored: this gate requires a reject reason', {
            approvalId: event.approvalId,
            taskId,
            stepId,
            channelId: event.channelId,
          })
          ctx.activity.log('channel', `Gate "${stepId}" reject ignored because a reason is required. Use the Bakin approval link to reject with a reason.`, { taskId })
          return
        }
        const rejectReason = channelComment || 'Rejected via runtime channel'
        const approvalRef = approvalRefFromRecord(approvalRecord)
        const result = rejectGate(taskId, stepId, rejectReason, { approver })
        if (!result.success) {
          log.warn(`Channel reject failed: ${result.errors?.[0] || 'unknown error'}`, { taskId, stepId })
          return
        }

        const auditPayload = buildGateAuditPayload(taskId, stepId, result.decision, rejectReason)
        ctx.activity.audit('gate.rejected', 'channel', auditPayload)
        ctx.activity.log('channel', `Gate "${stepId}" rejected via runtime channel: ${rejectReason}`, { taskId })
        indexInstance(taskId).catch(() => {})

        const instance = loadInstance(taskId)
        if (instance && result.decision) {
          resolveGateApproval(
            approvalRef,
            'rejected',
            approver,
            result.decision.decidedAt,
            rejectReason,
          ).catch(() => {})
          sendGateDecisionSummary(
            instance,
            stepId,
            result.decision.gateLabel,
            getGateDescription(instance.workflowId, stepId),
            'rejected',
            approver,
            result.decision.requestedAt,
            result.decision.decidedAt,
            rejectReason,
            activeGateSettings(),
          ).catch(() => {})
        }
      }
    })

    ctx.hooks.register('workflows.loadInstance', (d: Record<string, unknown>) => loadInstance(d.taskId as string, d.contentDir as string | undefined), { label: 'Load workflow instance.', summary: 'Loads the workflow instance attached to a task. Use it when a plugin needs current workflow state without reading workflow files directly.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.saveInstance', (d: Record<string, unknown>) => saveInstance(d.instance as Parameters<typeof saveInstance>[0], d.contentDir as string | undefined), { label: 'Save workflow instance.', summary: 'Persists a workflow instance after a plugin has changed its state. Use it to keep workflow updates routed through the workflow plugin storage layer.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.createInstance', (d: Record<string, unknown>) => createValidatedInstance(ctx, d.taskId as string, d.workflowId as string, d.assignee as string | undefined, d.contentDir as string | undefined, d.parentContext as Record<string, unknown> | undefined), { label: 'Create workflow instance.', summary: 'Creates a workflow instance for a task and optional assignee context. Use it when task creation or routing should immediately attach a workflow.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.approveGate', (d: Record<string, unknown>) => approveGate(d.taskId as string, d.stepId as string, {
      approver: d.approver as ApprovalActor | undefined,
      contentDir: d.contentDir as string | undefined,
    }), { label: 'Approve workflow gate.', summary: 'Approves a pending workflow gate and advances the instance. Use it from plugins that own an external review surface for workflow-backed tasks.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.rejectGate', (d: Record<string, unknown>) => rejectGate(d.taskId as string, d.stepId as string, String(d.reason ?? ''), {
      approver: d.approver as ApprovalActor | undefined,
      rewindTo: d.rewindTo as string | undefined,
      contentDir: d.contentDir as string | undefined,
    }), { label: 'Reject workflow gate.', summary: 'Rejects a pending workflow gate, records the reason, and rewinds the instance per the workflow gate policy. Use it from plugins that own an external review surface for workflow-backed tasks.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.reopenFromStep', (d: Record<string, unknown>) => reopenFromStep(d.taskId as string, {
      instanceId: d.instanceId as string | undefined,
      stepId: d.stepId as string | undefined,
      reason: String(d.reason ?? 'Workflow recovery requested'),
      actor: d.actor as ApprovalActor | undefined,
      contentDir: d.contentDir as string | undefined,
    }), { label: 'Reopen workflow from step.', summary: 'Reopens an existing workflow instance at a prior actionable step. Use it when a plugin needs explicit user recovery without creating a replacement workflow task.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.instances.list', (d: Record<string, unknown>) => listInstances(d.statusFilter as string | undefined, d.contentDir as string | undefined), { label: 'List workflow instances.', summary: 'Returns workflow instances, optionally filtered by status. Use it for dashboards, queues, and maintenance flows that need a broad view of active workflow state.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.getCurrentStep', (d: Record<string, unknown>) => getCurrentStep(d.taskId as string, d.agentId as string | undefined, d.contentDir as string | undefined), { label: 'Get current step.', summary: 'Returns the current workflow step for a task, optionally scoped to an agent. Use it when a plugin needs to know what work is currently actionable.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.completeStep', (d: Record<string, unknown>) => completeStep(d.taskId as string, d.stepId as string, d.output as Record<string, unknown>, d.callerAgentId as string | undefined, d.contentDir as string | undefined), { label: 'Complete workflow step.', summary: 'Submits output for a workflow step and advances the instance when validation passes. Use it from agents or tools that finish a workflow action.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.matchWorkflow', (d: Record<string, unknown>) => matchWorkflow(d.title as string, d.description as string | undefined), { label: 'Match workflow.', summary: 'Suggests a workflow based on a task title and description. Use it when creating tasks that should automatically pick the most relevant workflow template.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.definitions.list', (d: Record<string, unknown>) => listDefinitions(d.contentDir as string | undefined), { label: 'List workflow definitions.', summary: 'Returns available workflow definitions from the configured content directory. Use it to populate workflow selectors or validate workflow ids before creating instances.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.loadDefinition', (d: Record<string, unknown>) => {
      const name = workflowDefinitionNameFromHookInput(d)
      return name ? loadDefinition(name, d.contentDir as string | undefined) : null
    }, { label: 'Load workflow definition.', summary: 'Loads one workflow definition by name. Use it when a plugin needs the template shape, steps, or metadata behind a workflow id.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.getActiveAgents', (d: Record<string, unknown>) => getActiveAgents(d.taskId as string, d.contentDir as string | undefined), { label: 'List active workflow agents.', summary: 'Returns agents currently active in a workflow task. Use it for coordination, notification, or assignment views that need live workflow participants.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.authorizeToolUse', (d: Record<string, unknown>) => authorizeWorkflowToolUse(d.taskId as string, d.agent as string, d.action as WorkflowToolUseAction, d.contentDir as string | undefined), { label: 'Authorize workflow tool use.', summary: 'Checks whether an agent may perform a workflow-scoped tool action for a task. Use it before executing workflow-sensitive automation.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.isGateNotified', (d: Record<string, unknown>) => isGateNotified(d.taskId as string, d.stepId as string, d.contentDir as string | undefined), { label: 'Check gate notification.', summary: 'Checks whether a workflow gate notification has already been sent. Use it to avoid duplicate alerts for the same task and gate step.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.markGateNotified', (d: Record<string, unknown>) => markGateNotified(d.taskId as string, d.stepId as string, d.contentDir as string | undefined), { label: 'Mark gate notified.', summary: 'Records that a workflow gate notification was sent. Use it immediately after notifying a reviewer or channel so future checks can suppress duplicates.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.validateStepOutput', (d: Record<string, unknown>) => validateStepOutput(d.schema as Record<string, unknown> | undefined, d.output as Record<string, unknown>), { label: 'Validate step output.', summary: 'Validates workflow step output against the step schema. Use it before accepting agent or tool output that should advance a workflow.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.cancelInstance', (d: Record<string, unknown>) => {
      cancelInstance(d.taskId as string, d.contentDir as string | undefined)
    }, { label: 'Cancel workflow instance.', summary: 'Cancels the workflow instance attached to a task. Use it when task state changes make the workflow no longer relevant or safe to continue.', hookKind: 'event' })

    // ─── Notification Channel Registry Hooks ─────────────────────────
    ctx.hooks.register('workflows.notificationChannels.list', () => listNotificationChannels(), { label: 'List notification channels.', summary: 'Returns workflow notification channels registered by core or plugins. Use it to show available delivery targets for gate and workflow alerts.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.getNotificationChannel', (d: Record<string, unknown>) => {
      return getNotificationChannel(d.id as string) ?? null
    }, { label: 'Get notification channel.', summary: 'Returns one workflow notification channel by id. Use it before sending or configuring alerts that depend on a specific channel implementation.', hookKind: 'rpc' })

    // ─── Notification Channels Route — registered statically via populateWorkflowRoutes() (T20+) ───

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

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_list',
      label: 'Listed workflows',
      description: 'List all workflow definitions (templates). Returns name, filename, description, and step count for each.',
      parameters: {},
      handler: async () => {
        const { templates } = buildTemplateList()
        return {
          ok: true,
          templates: templates.map(t => ({
            name: t.name,
            filename: t.filename,
            description: t.description,
            stepCount: t.stepCount,
          })),
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_get_definition',
      label: 'Read workflow definition',
      description: 'Get a workflow definition by filename. Returns the full definition with steps, inputs, and resolved sub-workflows.',
      parameters: {
        name: z.string().describe('Workflow definition filename (e.g. "content-pipeline")'),
      },
      handler: async (params: Record<string, unknown>) => {
        const definition = loadDefinition(params.name as string)
        if (!definition) return { ok: false, error: `Definition not found: ${params.name}` }

        const subWorkflows: Record<string, WorkflowDefinition> = {}
        resolveSubWorkflows(definition.steps, subWorkflows)

        return { ok: true, definition, subWorkflows }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_start',
      label: 'Started a workflow',
      activityDuplicate: true,
      description: 'Start a workflow instance for a task. The task must exist on the board. Returns the created instance.',
      parameters: {
        taskId: z.string().describe('Task ID to start workflow for'),
        workflowId: z.string().describe('Workflow definition filename'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const taskId = params.taskId as string
        const workflowId = params.workflowId as string

        try {
          let assignee: string | undefined
          try {
            assignee = getTask(taskId)?.agent
          } catch { /* best effort */ }

          const instance = await createValidatedInstance(ctx, taskId, workflowId, assignee)

          try {
            await updateTask(taskId, { workflowId })
          } catch { /* non-fatal */ }

          ctx.activity.audit('started', agent, { taskId, workflowId })
          indexInstance(taskId).catch(() => {})

          return { ok: true, instance }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_list_instances',
      label: 'Listed workflow runs',
      description: 'List workflow instances. Optionally filter by status (in_progress, pending_approval, complete, failed, cancelled).',
      parameters: {
        status: z.enum(['in_progress', 'pending_approval', 'complete', 'failed', 'cancelled']).optional().describe('Filter by instance status'),
      },
      handler: async (params: Record<string, unknown>) => {
        const instances = listInstances(params.status as string | undefined)
        return { ok: true, instances }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_get_instance',
      label: 'Read workflow instance',
      description: 'Get the full state of a workflow instance for a task, including step states and history.',
      parameters: {
        taskId: z.string().describe('Task ID'),
      },
      handler: async (params: Record<string, unknown>) => {
        const instance = loadInstance(params.taskId as string)
        if (!instance) return { ok: false, error: `No workflow instance found for task: ${params.taskId}` }
        return { ok: true, instance }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_get_step',
      label: 'Read workflow step',
      description: 'Get the current workflow step for a task. Returns only the current step (information gating — future steps are hidden). Critical for agents to know what to do next.',
      parameters: {
        taskId: z.string().describe('Task ID'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const step = getCurrentStep(params.taskId as string, agent)
        if (!step) return { ok: false, error: `No active workflow step found for task "${params.taskId}" owned by agent "${agent}"` }
        return { ok: true, ...step }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_complete_step',
      label: 'Completed workflow step',
      activityDuplicate: true,
      description: 'Complete a workflow step with output. Validates output against the step schema, advances the workflow to the next step. Returns success status and whether the workflow is complete.',
      parameters: {
        taskId: z.string().describe('Task ID'),
        stepId: z.string().describe('Step ID to complete'),
        output: z.record(z.string(), z.unknown()).describe('Step output object'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const taskId = params.taskId as string
        const stepId = params.stepId as string
        const agentId = agent
        const output = params.output as Record<string, unknown>

        const result = completeStep(taskId, stepId, output, agentId)

        if (!result.success) {
          return { ok: false, error: 'Step completion failed', errors: result.errors }
        }

        ctx.activity.audit('step.completed', agentId, { taskId, stepId, workflowComplete: result.workflowComplete })
        indexInstance(taskId).catch(() => {})

        if (!result.workflowComplete) {
          triggerDispatch()
        }

        return { ok: true, workflowComplete: result.workflowComplete, nextStep: result.nextStep }
      },
    })

    // ─── Migrated Script Tools (formerly scripts/lib/) ─────────────────

    // bakin_exec_get_step — human-readable step context formatter
    ctx.registerExecTool({
      name: 'bakin_exec_get_step',
      label: 'Read workflow step',
      description: 'Get the current workflow step as human-readable formatted text. Includes instructions, prior outputs, schema, and rejection context in a clear structure.',
      parameters: {
        taskId: z.string().describe('Task ID'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        try {
          const step = getCurrentStep(params.taskId as string, agent) as Record<string, unknown> | undefined
          if (!step) return { ok: false, error: 'No active step found for this task' }
          const formatted = formatStepContext(step)
          return { ok: true, formatted, raw: step }
        } catch (err) {
          return { ok: false, error: `Failed to get step: ${err instanceof Error ? err.message : String(err)}` }
        }
      },
    })

    // bakin_exec_submit_step — local pre-validation before server submission
    ctx.registerExecTool({
      name: 'bakin_exec_submit_step',
      label: 'Submitted workflow step',
      activityDuplicate: true,
      description: 'Submit workflow step output with local pre-validation. Validates against the step schema BEFORE hitting the server, giving you detailed field-level errors without a round trip.',
      parameters: {
        taskId: z.string().describe('Task ID'),
        stepId: z.string().describe('Step ID to submit for'),
        output: z.record(z.string(), z.unknown()).describe('JSON output matching the step schema'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const taskId = params.taskId as string
        const stepId = params.stepId as string
        const output = params.output as Record<string, unknown>

        try {
          // Fetch current step to get schema
          const step = getCurrentStep(taskId, agent) as Record<string, unknown> | undefined
          if (!step) return { ok: false, error: 'No active step found for this task' }

          const schema = step.output_schema as Record<string, unknown> | undefined

          // Local pre-validation if schema exists
          if (schema) {
            const validation = validateStepOutput(schema, output)
            if (validation && !validation.valid) {
              return { ok: false, error: 'Schema validation failed — fix these before resubmitting', details: validation.errors }
            }
          }

          // Submit to server
          const result = completeStep(taskId, stepId, output, agent)

          if (!result.success) {
            return { ok: false, error: 'Step completion failed', errors: result.errors }
          }

          ctx.activity.audit('step.completed', agent, { taskId, stepId, workflowComplete: result.workflowComplete })
          indexInstance(taskId).catch(() => {})

          if (!result.workflowComplete) {
            triggerDispatch()
          }

          return { ok: true, workflowComplete: result.workflowComplete, nextStep: result.nextStep }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('near-duplicate') || msg.includes('rejection')) {
            return { ok: false, error: 'Submission rejected: output is too similar to your previous rejected submission. Address the feedback and make substantive changes.' }
          }
          return { ok: false, error: `Failed to submit step: ${msg}` }
        }
      },
    })

    // bakin_exec_check_gates — human-readable gate status overview
    ctx.registerExecTool({
      name: 'bakin_exec_check_gates',
      label: 'Checked workflow gates',
      description: 'Get a human-readable overview of all gate statuses in a workflow. Shows which gates are approved, waiting, or pending.',
      parameters: {
        taskId: z.string().describe('Task ID (or workflow instance ID)'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          const instance = loadInstance(params.taskId as string)
          if (!instance) return { ok: false, error: 'No workflow instance found for this task' }

          const STATUS_DISPLAY: Record<string, string> = {
            complete: 'APPROVED', pending_approval: 'WAITING', pending: 'PENDING',
            rejected: 'REJECTED', in_progress: 'IN PROGRESS',
          }

          const lines: string[] = []
          lines.push(`WORKFLOW: ${instance.workflowId} (${params.taskId})`)
          lines.push(`STATUS: ${instance.status}`)
          lines.push('')
          lines.push('GATES:')

          let hasGates = false
          const stepStates = (instance.stepStates || {}) as unknown as Record<string, Record<string, unknown>>
          for (const [stepId, state] of Object.entries(stepStates)) {
            const s = state as { status: string; completedAt?: string; startedAt?: string }
            const isGate = s.status === 'pending_approval' ||
              stepId.includes('gate') || stepId.includes('review') || stepId.includes('approval')
            if (!isGate) continue
            hasGates = true

            const display = STATUS_DISPLAY[s.status] || s.status.toUpperCase()
            const time = s.completedAt
              ? `  (${new Date(s.completedAt).toLocaleString()})`
              : s.startedAt
                ? `  (since ${new Date(s.startedAt).toLocaleString()})`
                : ''
            lines.push(`  ${stepId.padEnd(24)} ${display}${time}`)
          }

          if (!hasGates) lines.push('  (no gates found in this workflow)')
          lines.push('')
          lines.push(`CURRENT STEP: ${instance.currentStepId}`)

          return { ok: true, formatted: lines.join('\n') }
        } catch (err) {
          return { ok: false, error: `Failed to check gates: ${err instanceof Error ? err.message : String(err)}` }
        }
      },
    })
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
