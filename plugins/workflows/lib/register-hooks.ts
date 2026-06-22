/**
 * Workflow HookRegistry registrations
 *
 * registerWorkflowHooks(ctx) registers every cross-plugin workflow hook (the
 * runtime/instance/gate RPC surface + the notification-channel lookups) so
 * other plugins reach workflow state through the HookRegistry rather than
 * importing this plugin directly. Extracted verbatim from the activate() body.
 */
import type { PluginContext, ApprovalActor } from '@bakin/core/plugin-types'
import {
  loadInstance,
  saveInstance,
  approveGate,
  rejectGate,
  reopenFromStep,
  listInstances,
  getCurrentStep,
  completeStep,
  getActiveAgents,
  authorizeWorkflowToolUse,
  isGateNotified,
  markGateNotified,
  cancelInstance,
  type WorkflowToolUseAction,
} from './runtime'
import { createValidatedInstance } from './start-validation'
import { matchWorkflow } from './matcher'
import { listDefinitions, loadDefinition } from './parser'
import { workflowDefinitionNameFromHookInput } from './hook-input'
import { validateStepOutput } from './schema-validator'
import { listNotificationChannels, getNotificationChannel } from './notification-channel-registry'

export function registerWorkflowHooks(ctx: PluginContext): void {
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
}
