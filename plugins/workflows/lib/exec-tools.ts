/**
 * Workflow MCP exec tools
 *
 * registerWorkflowExecTools(ctx) registers every workflow exec tool: the
 * template/instance reads, start, the step read/complete/submit agent surface,
 * and the human-readable get-step / check-gates formatters. Extracted from the
 * activate() body; each tool delegates to the template-list / runtime /
 * start-validation / search-sync / step-format lib modules.
 */
import { z } from 'zod'
import type { PluginContext } from '@bakin/core/plugin-types'
import type { WorkflowDefinition } from '../types'
import { buildTemplateList, resolveSubWorkflows } from './template-list'
import { loadDefinition, findStep } from './parser'
import { getCurrentStep, completeStep, listInstances, loadInstance } from './runtime'
import { createValidatedInstance } from './start-validation'
import { indexInstance } from './search-sync'
import { triggerDispatch } from './trigger-dispatch'
import { formatStepContext } from './step-format'
import { validateStepOutput } from './schema-validator'
import { getTask, updateTask } from '../../../src/core/task-store'

export function registerWorkflowExecTools(ctx: PluginContext): void {
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
          if (result.code === 'rejection_repeat') {
            return { ok: false, error: 'Submission rejected: output is too similar to your previous rejected submission. Address the feedback and make substantive changes.', errors: result.errors }
          }
          return { ok: false, error: 'Step completion failed', errors: result.errors }
        }

        ctx.activity.audit('step.completed', agent, { taskId, stepId, workflowComplete: result.workflowComplete })
        indexInstance(taskId).catch(() => {})

        if (!result.workflowComplete) {
          triggerDispatch()
        }

        return { ok: true, workflowComplete: result.workflowComplete, nextStep: result.nextStep }
      } catch (err) {
        return { ok: false, error: `Failed to submit step: ${err instanceof Error ? err.message : String(err)}` }
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

        // Gate detection is by the definition's step type — never by
        // stepId naming (a step merely NAMED "review" is not a gate).
        const def = loadDefinition(instance.workflowId)

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
          const defStep = def ? findStep(def, stepId) : null
          const isGate = defStep?.type === 'gate' || s.status === 'pending_approval'
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
}
