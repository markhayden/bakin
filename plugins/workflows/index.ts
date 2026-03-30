/**
 * Workflows plugin — template library + runtime engine.
 * Enforces step-by-step agent execution with gated delivery,
 * parallel steps, human gates, and output validation.
 */
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
import { validateStepOutput } from './schema-validator'
import { setEventBus } from './notifications'
import type { WorkflowTemplate, WorkflowDefinition, NestedWorkflowStep } from './types'

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

    // GET /api/plugins/workflows/list — list all workflow templates
    ctx.registerRoute({
      path: '/list',
      method: 'GET',
      description: 'List all workflow templates with step counts and resolved sub-workflows',
      handler: async () => {
        const defs = listDefinitions()

        // Collect all referenced sub-workflow definitions
        const subWorkflows: Record<string, WorkflowDefinition> = {}
        function resolveSubWorkflows(steps: WorkflowDefinition['steps']) {
          for (const step of steps) {
            if (step.type === 'workflow') {
              const nested = step as NestedWorkflowStep
              if (nested.workflow_id && !subWorkflows[nested.workflow_id]) {
                const subDef = loadDefinition(nested.workflow_id)
                if (subDef) {
                  subWorkflows[nested.workflow_id] = subDef
                  // Recursively resolve nested sub-workflows
                  resolveSubWorkflows(subDef.steps)
                }
              }
            }
          }
        }

        const templates: WorkflowTemplate[] = defs.map(d => {
          resolveSubWorkflows(d.definition.steps)
          return {
            name: d.definition.name,
            filename: d.name,
            description: d.definition.description,
            stepCount: countSteps(d.definition.steps),
            definition: d.definition,
          }
        })
        return Response.json({ templates, subWorkflows })
      },
    })

    // GET /api/plugins/workflows/definition?name=<filename> — get a specific definition
    ctx.registerRoute({
      path: '/definition',
      method: 'GET',
      description: 'Get a specific workflow definition by name',
      params: '?name=<filename>',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const name = url.searchParams.get('name')

        if (!name) {
          return Response.json({ error: 'name query param required' }, { status: 400 })
        }

        const definition = loadDefinition(name)
        if (!definition) {
          return Response.json({ error: 'Definition not found' }, { status: 404 })
        }

        return Response.json({ definition })
      },
    })

    // ─── Runtime Routes ───────────────────────────────────────────────

    // GET /api/plugins/workflows/step?taskId=<id> — get current step for a task
    ctx.registerRoute({
      path: '/step',
      method: 'GET',
      description: 'Get current workflow step for a task. Returns step context or blocked/complete status.',
      params: '?taskId=<id>&agentId=<optional>',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const taskId = url.searchParams.get('taskId')
        const agentId = url.searchParams.get('agentId') || undefined

        if (!taskId) {
          return Response.json({ error: 'taskId query param required' }, { status: 400 })
        }

        const step = getCurrentStep(taskId, agentId)
        if (!step) {
          return Response.json({ error: 'No workflow instance found for task' }, { status: 404 })
        }

        return Response.json(step)
      },
    })

    // POST /api/plugins/workflows/step/complete — submit step output
    ctx.registerRoute({
      path: '/step/complete',
      method: 'POST',
      description: 'Submit step output. Validates against schema, advances workflow.',
      params: '{"taskId":"string","stepId":"string","output":{}}',
      handler: async (req: Request) => {
        let body: { taskId?: string; stepId?: string; agentId?: string; output?: Record<string, unknown> }
        try {
          body = await req.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const { taskId, stepId, agentId, output } = body
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

        // Kick dispatch so the next step's agent starts immediately
        if (!result.workflowComplete) {
          triggerDispatch()
        }

        return Response.json(result)
      },
    })

    // POST /api/plugins/workflows/approve — approve a gate step
    ctx.registerRoute({
      path: '/approve',
      method: 'POST',
      description: 'Approve a human gate step. Advances workflow past gate.',
      params: '{"taskId":"string","stepId":"string"}',
      handler: async (req: Request) => {
        let body: { taskId?: string; stepId?: string }
        try {
          body = await req.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const { taskId, stepId } = body
        if (!taskId || !stepId) {
          return Response.json({ error: 'taskId and stepId are required' }, { status: 400 })
        }

        const result = approveGate(taskId, stepId)

        if (!result.success) {
          return Response.json({ error: result.errors?.[0], errors: result.errors }, { status: 400 })
        }

        // Kick dispatch so the next step's agent starts immediately
        triggerDispatch()

        return Response.json(result)
      },
    })

    // POST /api/plugins/workflows/reject — reject a gate step
    ctx.registerRoute({
      path: '/reject',
      method: 'POST',
      description: 'Reject a gate step. Rewinds workflow to target step.',
      params: '{"taskId":"string","stepId":"string","reason":"string","rewindTo?":"string"}',
      handler: async (req: Request) => {
        let body: { taskId?: string; stepId?: string; reason?: string; rewindTo?: string }
        try {
          body = await req.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const { taskId, stepId, reason, rewindTo } = body
        if (!taskId || !stepId || !reason) {
          return Response.json({ error: 'taskId, stepId, and reason are required' }, { status: 400 })
        }

        const result = rejectGate(taskId, stepId, reason, rewindTo)

        if (!result.success) {
          return Response.json({ error: result.errors?.[0], errors: result.errors }, { status: 400 })
        }

        return Response.json(result)
      },
    })

    // GET /api/plugins/workflows/instances — list active workflow instances
    ctx.registerRoute({
      path: '/instances',
      method: 'GET',
      description: 'List active workflow instances. Optional status filter.',
      params: '?status=<in_progress|pending_approval|complete|failed>',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const status = url.searchParams.get('status') || undefined

        const instances = listInstances(status)
        return Response.json({ instances })
      },
    })

    // GET /api/plugins/workflows/instance?taskId=<id> — get full instance state
    ctx.registerRoute({
      path: '/instance',
      method: 'GET',
      description: 'Get full workflow instance state for a task.',
      params: '?taskId=<id>',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const taskId = url.searchParams.get('taskId')

        if (!taskId) {
          return Response.json({ error: 'taskId query param required' }, { status: 400 })
        }

        const instance = loadInstance(taskId)
        if (!instance) {
          return Response.json({ error: 'No workflow instance found for task' }, { status: 404 })
        }

        return Response.json({ instance })
      },
    })

    // GET /api/plugins/workflows/pending-gates — list all gates awaiting approval
    ctx.registerRoute({
      path: '/pending-gates',
      method: 'GET',
      description: 'List all workflow instances with pending gate approvals.',
      handler: async () => {
        const instances = listInstances('pending_approval')
        const gates = instances.map((inst) => {
          const def = loadDefinition(inst.workflowId)
          const gateStep = def?.steps.find(s => s.id === inst.currentStepId)

          // Gather prior step outputs for review
          let priorStepOutputs: Record<string, unknown> = {}
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
      },
    })

    // GET /api/plugins/workflows/gate-status — batch check gate status for tasks
    ctx.registerRoute({
      path: '/gate-status',
      method: 'GET',
      description: 'Batch check gate status for multiple tasks. Returns map of taskId → gate info.',
      params: '?taskIds=id1,id2,...',
      handler: async (req: Request) => {
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
            // Check if any step has an active child workflow
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
      },
    })

    // POST /api/plugins/workflows/start — start a workflow for a task
    ctx.registerRoute({
      path: '/start',
      method: 'POST',
      description: 'Start a workflow instance for a task.',
      params: '{"taskId":"string","workflowId":"string"}',
      handler: async (req: Request) => {
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

          return Response.json({ instance })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 400 })
        }
      },
    })
  },
}

export default workflowsPlugin
