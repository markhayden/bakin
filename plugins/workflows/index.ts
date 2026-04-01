/**
 * Workflows plugin — template library + runtime engine.
 * Enforces step-by-step agent execution with gated delivery,
 * parallel steps, human gates, and output validation.
 */
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { listDefinitions, loadDefinition } from './parser'
import {
  createInstance,
  loadInstance,
  saveInstance,
  getCurrentStep,
  completeStep,
  approveGate,
  rejectGate,
  listInstances,
  getActiveAgents,
  isGateNotified,
  markGateNotified,
} from './runtime'
import { matchWorkflow } from './matcher'
import { createLogger } from '../../src/core/logger'
import { validateStepOutput } from './schema-validator'
import { setEventBus } from './notifications'
import type { WorkflowTemplate, WorkflowDefinition, NestedWorkflowStep } from './types'

const log = createLogger('workflows')

/** Fire-and-forget dispatch trigger so the next workflow step's agent starts immediately. */
function triggerDispatch() {
  const port = Number(process.env.PORT || 3737)
  fetch(`http://localhost:${port}/api/dispatch`, { method: 'POST' }).catch(() => {})
}

function countSteps(steps: { type: string; steps?: unknown[] }[]): number {
  let count = 0
  for (const step of steps) {
    if (step.type === 'parallel' && Array.isArray(step.steps)) {
      count += step.steps.length
    } else {
      count++
    }
  }
  return count
}

const workflowsPlugin: BakinPlugin = {
  id: 'workflows',
  name: 'Workflows',
  version: '2.0.0',

  settingsSchema: {
    fields: [
      { key: 'gateTimeout', type: 'number', label: 'Gate timeout (hours)', description: 'Auto-reject gates not approved within this time', default: 24 },
      { key: 'maxConcurrentSteps', type: 'number', label: 'Max concurrent steps', description: 'Maximum steps running in parallel per workflow', default: 3 },
      { key: 'notifyOnGate', type: 'boolean', label: 'Notify on gate', description: 'Send notification when a gate needs approval', default: true },
    ],
  },

  navItems: [
    { id: 'workflows', label: 'Workflows', icon: 'Workflow', href: '/workflows', order: 15 },
  ],

  contentFiles: [],

  activate(ctx: PluginContext) {
    // Wire up event bus for notifications
    setEventBus(ctx.events)

    // Register cross-plugin hooks
    ctx.hooks.register('workflows.loadInstance', (d: Record<string, unknown>) => loadInstance(d.taskId as string, d.contentDir as string | undefined))
    ctx.hooks.register('workflows.saveInstance', (d: Record<string, unknown>) => saveInstance(d.instance as Parameters<typeof saveInstance>[0], d.contentDir as string | undefined))
    ctx.hooks.register('workflows.createInstance', (d: Record<string, unknown>) => createInstance(d.taskId as string, d.workflowId as string, d.contentDir as string | undefined, d.assignee as string | undefined, d.parentContext as Record<string, unknown> | undefined))
    ctx.hooks.register('workflows.listInstances', (d: Record<string, unknown>) => listInstances(d.statusFilter as string | undefined, d.contentDir as string | undefined))
    ctx.hooks.register('workflows.getCurrentStep', (d: Record<string, unknown>) => getCurrentStep(d.taskId as string, d.agentId as string | undefined, d.contentDir as string | undefined))
    ctx.hooks.register('workflows.completeStep', (d: Record<string, unknown>) => completeStep(d.taskId as string, d.stepId as string, d.output as Record<string, unknown>, d.callerAgentId as string | undefined, d.contentDir as string | undefined))
    ctx.hooks.register('workflows.matchWorkflow', (d: Record<string, unknown>) => matchWorkflow(d.title as string, d.description as string | undefined))
    ctx.hooks.register('workflows.listDefinitions', (d: Record<string, unknown>) => listDefinitions(d.contentDir as string | undefined))
    ctx.hooks.register('workflows.loadDefinition', (d: Record<string, unknown>) => loadDefinition(d.name as string, d.contentDir as string | undefined))
    ctx.hooks.register('workflows.getActiveAgents', (d: Record<string, unknown>) => getActiveAgents(d.taskId as string, d.contentDir as string | undefined))
    ctx.hooks.register('workflows.isGateNotified', (d: Record<string, unknown>) => isGateNotified(d.taskId as string, d.stepId as string, d.contentDir as string | undefined))
    ctx.hooks.register('workflows.markGateNotified', (d: Record<string, unknown>) => markGateNotified(d.taskId as string, d.stepId as string, d.contentDir as string | undefined))
    ctx.hooks.register('workflows.validateStepOutput', (d: Record<string, unknown>) => validateStepOutput(d.schema as Record<string, unknown> | undefined, d.output as Record<string, unknown>))

    // ─── Template Routes ──────────────────────────────────────────────

    /** Collect all referenced sub-workflow definitions recursively */
    function resolveSubWorkflows(steps: WorkflowDefinition['steps'], subWorkflows: Record<string, WorkflowDefinition>) {
      for (const step of steps) {
        if (step.type === 'workflow') {
          const nested = step as NestedWorkflowStep
          if (nested.workflow_id && !subWorkflows[nested.workflow_id]) {
            const subDef = loadDefinition(nested.workflow_id)
            if (subDef) {
              subWorkflows[nested.workflow_id] = subDef
              resolveSubWorkflows(subDef.steps, subWorkflows)
            }
          }
        }
      }
    }

    /** Build template list with sub-workflow resolution */
    function buildTemplateList() {
      const defs = listDefinitions()
      const subWorkflows: Record<string, WorkflowDefinition> = {}
      const templates: WorkflowTemplate[] = defs.map(d => {
        resolveSubWorkflows(d.definition.steps, subWorkflows)
        return {
          name: d.definition.name,
          filename: d.name,
          description: d.definition.description,
          stepCount: countSteps(d.definition.steps),
          definition: d.definition,
        }
      })
      return { templates, subWorkflows }
    }

    // GET /definitions — list all workflow templates
    const listHandler = async () => Response.json(buildTemplateList())
    ctx.registerRoute({ path: '/definitions', method: 'GET', description: 'List all workflow templates with step counts and resolved sub-workflows', handler: listHandler })
    ctx.registerRoute({ path: '/list', method: 'GET', description: 'List all workflow templates (alias)', handler: listHandler })

    // GET /definitions/:name — get a specific definition with resolved sub-workflows
    const getDefinitionHandler = async (req: Request) => {
      const url = new URL(req.url)
      const name = url.searchParams.get('name')

      if (!name) {
        return Response.json({ error: 'name param required' }, { status: 400 })
      }

      const definition = loadDefinition(name)
      if (!definition) {
        return Response.json({ error: 'Definition not found' }, { status: 404 })
      }

      // Include resolved sub-workflows so clients don't need a second fetch
      const subWorkflows: Record<string, WorkflowDefinition> = {}
      resolveSubWorkflows(definition.steps, subWorkflows)

      return Response.json({ definition, subWorkflows })
    }
    ctx.registerRoute({ path: '/definitions/:name', method: 'GET', description: 'Get a specific workflow definition by name', handler: getDefinitionHandler })
    ctx.registerRoute({ path: '/definition', method: 'GET', description: 'Get a specific workflow definition (alias)', handler: getDefinitionHandler })

    // ─── Runtime Routes ���──────────────────────────────��───────────────

    // GET /steps/:taskId — get current step for a task
    const getStepHandler = async (req: Request) => {
      const url = new URL(req.url)
      const taskId = url.searchParams.get('taskId')
      const agentId = url.searchParams.get('agentId') || undefined

      if (!taskId) {
        return Response.json({ error: 'taskId param required' }, { status: 400 })
      }

      const step = getCurrentStep(taskId, agentId)
      if (!step) {
        return Response.json({ error: 'No workflow instance found for task' }, { status: 404 })
      }

      return Response.json(step)
    }
    ctx.registerRoute({ path: '/steps/:taskId', method: 'GET', description: 'Get current workflow step for a task', handler: getStepHandler })
    ctx.registerRoute({ path: '/step', method: 'GET', description: 'Get current workflow step (alias)', handler: getStepHandler })

    // POST /steps/:taskId/complete — submit step output
    const completeStepHandler = async (req: Request) => {
      const url = new URL(req.url)
      let body: { taskId?: string; stepId?: string; agentId?: string; output?: Record<string, unknown> }
      try {
        body = await req.json()
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }

      // Path param takes precedence over body
      const taskId = url.searchParams.get('taskId') || body.taskId
      const { stepId, agentId, output } = body
      if (!taskId || !stepId || !output) {
        return Response.json({ error: 'taskId, stepId, and output are required' }, { status: 400 })
      }
      if (!agentId) {
        return Response.json({ error: 'agentId required — which agent is submitting this output?' }, { status: 400 })
      }

      const result = completeStep(taskId, stepId, output, agentId)

      if (!result.success) {
        return Response.json({ error: 'Step completion failed', errors: result.errors }, { status: 400 })
      }

      ctx.activity.audit('step.completed', agentId, { taskId, stepId, workflowComplete: result.workflowComplete })
      ctx.activity.log(agentId, `Completed step "${stepId}"${result.workflowComplete ? ' — workflow complete' : ''}`, { taskId })

      // Kick dispatch so the next step's agent starts immediately
      if (!result.workflowComplete) {
        triggerDispatch()
      }

      return Response.json(result)
    }
    ctx.registerRoute({ path: '/steps/:taskId/complete', method: 'POST', description: 'Submit step output, validates against schema, advances workflow', handler: completeStepHandler })
    ctx.registerRoute({ path: '/step/complete', method: 'POST', description: 'Submit step output (alias)', handler: completeStepHandler })

    // POST /gates/:taskId/approve — approve a gate step
    const approveHandler = async (req: Request) => {
      const url = new URL(req.url)
      let body: { taskId?: string; stepId?: string }
      try {
        body = await req.json()
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }

      const taskId = url.searchParams.get('taskId') || body.taskId
      const { stepId } = body
      if (!taskId || !stepId) {
        return Response.json({ error: 'taskId and stepId are required' }, { status: 400 })
      }

      const result = approveGate(taskId, stepId)

      if (!result.success) {
        return Response.json({ error: result.errors?.[0], errors: result.errors }, { status: 400 })
      }

      ctx.activity.audit('gate.approved', 'system', { taskId, stepId })
      ctx.activity.log('system', `Gate "${stepId}" approved`, { taskId })

      // Kick dispatch so the next step's agent starts immediately
      triggerDispatch()

      return Response.json(result)
    }
    ctx.registerRoute({ path: '/gates/:taskId/approve', method: 'POST', description: 'Approve a human gate step', handler: approveHandler })
    ctx.registerRoute({ path: '/approve', method: 'POST', description: 'Approve a gate step (alias)', handler: approveHandler })

    // POST /gates/:taskId/reject — reject a gate step
    const rejectHandler = async (req: Request) => {
      const url = new URL(req.url)
      let body: { taskId?: string; stepId?: string; reason?: string; rewindTo?: string }
      try {
        body = await req.json()
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }

      const taskId = url.searchParams.get('taskId') || body.taskId
      const { stepId, reason, rewindTo } = body
      if (!taskId || !stepId || !reason) {
        return Response.json({ error: 'taskId, stepId, and reason are required' }, { status: 400 })
      }

      const result = rejectGate(taskId, stepId, reason, rewindTo)

      if (!result.success) {
        return Response.json({ error: result.errors?.[0], errors: result.errors }, { status: 400 })
      }

      ctx.activity.audit('gate.rejected', 'system', { taskId, stepId, reason })
      ctx.activity.log('system', `Gate "${stepId}" rejected: ${reason}`, { taskId })

      return Response.json(result)
    }
    ctx.registerRoute({ path: '/gates/:taskId/reject', method: 'POST', description: 'Reject a gate step, rewinds workflow', handler: rejectHandler })
    ctx.registerRoute({ path: '/reject', method: 'POST', description: 'Reject a gate step (alias)', handler: rejectHandler })

    // GET /instances — list active workflow instances
    ctx.registerRoute({
      path: '/instances',
      method: 'GET',
      description: 'List active workflow instances. Optional status filter.',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const status = url.searchParams.get('status') || undefined
        const instances = listInstances(status)
        return Response.json({ instances })
      },
    })

    // GET /instances/:taskId ��� get full instance state
    const getInstanceHandler = async (req: Request) => {
      const url = new URL(req.url)
      const taskId = url.searchParams.get('taskId')

      if (!taskId) {
        return Response.json({ error: 'taskId param required' }, { status: 400 })
      }

      const instance = loadInstance(taskId)
      if (!instance) {
        return Response.json({ error: 'No workflow instance found for task' }, { status: 404 })
      }

      return Response.json({ instance })
    }
    ctx.registerRoute({ path: '/instances/:taskId', method: 'GET', description: 'Get full workflow instance state for a task', handler: getInstanceHandler })
    ctx.registerRoute({ path: '/instance', method: 'GET', description: 'Get instance state (alias)', handler: getInstanceHandler })

    // GET /gates/pending — list all gates awaiting approval
    const pendingGatesHandler = async () => {
      const instances = listInstances('pending_approval')
      const gates = instances.map((inst) => {
        const def = loadDefinition(inst.workflowId)
        const gateStep = def?.steps.find(s => s.id === inst.currentStepId)

        // Gather prior step outputs for review
        const priorStepOutputs: Record<string, unknown> = {}
        if (def && gateStep) {
          const gateIdx = def.steps.findIndex(s => s.id === gateStep.id)
          const preview = (gateStep as { preview?: string[] }).preview
          if (preview && preview.length > 0) {
            for (const pid of preview) {
              if (inst.stepStates[pid]?.output) {
                priorStepOutputs[pid] = inst.stepStates[pid].output
              }
            }
          } else if (gateIdx > 0) {
            const priorStep = def.steps[gateIdx - 1]
            if (inst.stepStates[priorStep.id]?.output) {
              priorStepOutputs[priorStep.id] = inst.stepStates[priorStep.id].output
            }
          }
        }

        return {
          taskId: inst.taskId,
          workflowId: inst.workflowId,
          stepId: inst.currentStepId,
          label: gateStep?.label || inst.currentStepId,
          description: (gateStep as { description?: string })?.description,
          priorStepOutputs,
          gateDefinition: gateStep ? {
            on_approve: (gateStep as { on_approve?: string }).on_approve,
            on_reject: (gateStep as { on_reject?: { goto: string; note_to_agent?: boolean } }).on_reject,
          } : undefined,
        }
      })

      return Response.json({ gates })
    }
    ctx.registerRoute({ path: '/gates/pending', method: 'GET', description: 'List all gates awaiting approval', handler: pendingGatesHandler })
    ctx.registerRoute({ path: '/pending-gates', method: 'GET', description: 'List pending gates (alias)', handler: pendingGatesHandler })

    // GET /gates/status — batch check gate status for tasks
    const gateStatusHandler = async (req: Request) => {
      const url = new URL(req.url)
      const taskIds = (url.searchParams.get('taskIds') || '').split(',').filter(Boolean)

      const result: Record<string, { stepId: string; label: string; description?: string; childTaskId?: string } | null> = {}
      for (const taskId of taskIds) {
        const instance = loadInstance(taskId)
        if (instance && instance.status === 'pending_approval') {
          const def = loadDefinition(instance.workflowId)
          const gateStep = def?.steps.find(s => s.id === instance.currentStepId)
          result[taskId] = {
            stepId: instance.currentStepId,
            label: gateStep?.label || instance.currentStepId,
            description: (gateStep as { description?: string })?.description,
          }
        } else if (instance && instance.status === 'in_progress') {
          const childEntry = Object.entries(instance.stepStates).find(
            ([, state]) => state.status === 'in_progress' && state.childTaskId
          )
          if (childEntry) {
            const def = loadDefinition(instance.workflowId)
            const step = def?.steps.find(s => s.id === childEntry[0])
            result[taskId] = {
              stepId: childEntry[0],
              label: step?.label || childEntry[0],
              childTaskId: childEntry[1].childTaskId,
            }
          } else {
            result[taskId] = null
          }
        } else {
          result[taskId] = null
        }
      }

      return Response.json({ gates: result })
    }
    ctx.registerRoute({ path: '/gates/status', method: 'GET', description: 'Batch check gate status for tasks', handler: gateStatusHandler })
    ctx.registerRoute({ path: '/gate-status', method: 'GET', description: 'Batch gate status (alias)', handler: gateStatusHandler })

    // POST /instances/start — start a workflow for a task
    const startHandler = async (req: Request) => {
      let body: { taskId?: string; workflowId?: string }
      try {
        body = await req.json()
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }

      const { taskId, workflowId } = body
      if (!taskId || !workflowId) {
        return Response.json({ error: 'taskId and workflowId are required' }, { status: 400 })
      }

      try {
        // Look up task assignee so $assigned steps resolve correctly
        let assignee: string | undefined
        try {
          const board = await ctx.hooks.invoke<{ columns: Record<string, Array<{ id: string; agent?: string }>> }>('tasks.readTaskboard', {})
          if (board) {
            for (const col of Object.values(board.columns)) {
              const task = col.find(t => t.id === taskId)
              if (task?.agent) { assignee = task.agent; break }
            }
          }
        } catch { /* best effort */ }

        const instance = createInstance(taskId, workflowId, undefined, assignee)

        // Ensure the task's workflowId is persisted in TASKBOARD.md
        try {
          await ctx.hooks.invoke<void>('tasks.updateTask', { identifier: taskId, updates: { workflowId } })
        } catch {
          // Non-fatal — instance is created regardless
        }

        ctx.activity.audit('started', 'system', { taskId, workflowId })
        ctx.activity.log('system', `Started workflow "${workflowId}"`, { taskId })

        return Response.json({ instance })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 400 })
      }
    }
    ctx.registerRoute({ path: '/instances/start', method: 'POST', description: 'Start a workflow instance for a task', handler: startHandler })
    ctx.registerRoute({ path: '/start', method: 'POST', description: 'Start workflow (alias)', handler: startHandler })

    // ─── MCP Exec Tools ────────────────────────────────────────────────

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_list',
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
            const board = await ctx.hooks.invoke<{ columns: Record<string, Array<{ id: string; agent?: string }>> }>('tasks.readTaskboard', {})
            if (board) {
              for (const col of Object.values(board.columns)) {
                const task = col.find(t => t.id === taskId)
                if (task?.agent) { assignee = task.agent; break }
              }
            }
          } catch { /* best effort */ }

          const instance = createInstance(taskId, workflowId, undefined, assignee)

          try {
            await ctx.hooks.invoke<void>('tasks.updateTask', { identifier: taskId, updates: { workflowId } })
          } catch { /* non-fatal */ }

          ctx.activity.audit('started', agent, { taskId, workflowId })
          ctx.activity.log(agent, `Started workflow "${workflowId}"`, { taskId })

          return { ok: true, instance }
        } catch (err) {
          return { ok: false, error: String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_list_instances',
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
      description: 'Get the current workflow step for a task. Returns only the current step (information gating — future steps are hidden). Critical for agents to know what to do next.',
      parameters: {
        taskId: z.string().describe('Task ID'),
        agentId: z.string().optional().describe('Agent ID requesting the step'),
      },
      handler: async (params: Record<string, unknown>) => {
        const step = getCurrentStep(params.taskId as string, params.agentId as string | undefined)
        if (!step) return { ok: false, error: `No workflow instance found for task: ${params.taskId}` }
        return { ok: true, ...step }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_workflows_complete_step',
      description: 'Complete a workflow step with output. Validates output against the step schema, advances the workflow to the next step. Returns success status and whether the workflow is complete.',
      parameters: {
        taskId: z.string().describe('Task ID'),
        stepId: z.string().describe('Step ID to complete'),
        agentId: z.string().describe('Agent ID submitting the output'),
        output: z.record(z.string(), z.unknown()).describe('Step output object'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const taskId = params.taskId as string
        const stepId = params.stepId as string
        const agentId = (params.agentId as string) || agent
        const output = params.output as Record<string, unknown>

        const result = completeStep(taskId, stepId, output, agentId)

        if (!result.success) {
          return { ok: false, error: 'Step completion failed', errors: result.errors }
        }

        ctx.activity.audit('step.completed', agentId, { taskId, stepId, workflowComplete: result.workflowComplete })
        ctx.activity.log(agentId, `Completed step "${stepId}"${result.workflowComplete ? ' — workflow complete' : ''}`, { taskId })

        if (!result.workflowComplete) {
          triggerDispatch()
        }

        return { ok: true, workflowComplete: result.workflowComplete }
      },
    })
  },

  onReady() {
    const instances = listInstances()
    const active = instances.filter(i => i.status === 'in_progress')
    if (active.length > 0) {
      log.info(`Ready — ${active.length} active workflow instance(s)`)
    }
    const defs = listDefinitions()
    log.info(`Ready — ${defs.length} workflow definition(s) loaded`)
  },

  onShutdown() {
    const active = listInstances().filter(i => i.status === 'in_progress')
    if (active.length > 0) {
      log.warn(`Shutting down with ${active.length} active workflow instance(s)`)
    }
  },
}

export default workflowsPlugin
