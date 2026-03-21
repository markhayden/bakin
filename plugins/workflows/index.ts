/**
 * Workflows plugin — template library + runtime engine.
 * Enforces step-by-step agent execution with gated delivery,
 * parallel steps, human gates, and output validation.
 */
import type { MCPlugin, PluginContext } from '../../src/lib/plugin-types'
import { listDefinitions, loadDefinition } from './parser'
import {
  createInstance,
  loadInstance,
  getCurrentStep,
  completeStep,
  approveGate,
  rejectGate,
  listInstances,
} from './runtime'
import { setEventBus } from './notifications'
import type { WorkflowTemplate } from './types'

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

const workflowsPlugin: MCPlugin = {
  id: 'workflows',
  name: 'Workflows',
  version: '2.0.0',

  navItems: [
    { id: 'workflows', label: 'Workflows', icon: 'Zap', href: '/workflows', order: 15 },
  ],

  contentFiles: [],

  activate(ctx: PluginContext) {
    // Wire up event bus for notifications
    setEventBus(ctx.events)

    // ─── Template Routes ──────────────────────────────────────────────

    // GET /api/plugins/workflows/list — list all workflow templates
    ctx.registerRoute({
      path: '/list',
      method: 'GET',
      description: 'List all workflow templates with step counts',
      handler: async () => {
        const defs = listDefinitions()
        const templates: WorkflowTemplate[] = defs.map(d => ({
          name: d.definition.name,
          filename: d.name,
          description: d.definition.description,
          stepCount: countSteps(d.definition.steps),
          definition: d.definition,
        }))
        return Response.json({ templates })
      },
    })

    // GET /api/plugins/workflows/definition?name=<filename> — get a specific definition
    ctx.registerRoute({
      path: '/definition',
      method: 'GET',
      description: 'Get a specific workflow definition by name',
      params: '?name=<filename>',
      handler: async (req) => {
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
      handler: async (req) => {
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
      handler: async (req) => {
        let body: { taskId?: string; stepId?: string; output?: Record<string, unknown> }
        try {
          body = await req.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const { taskId, stepId, output } = body
        if (!taskId || !stepId || !output) {
          return Response.json({ error: 'taskId, stepId, and output are required' }, { status: 400 })
        }

        const result = completeStep(taskId, stepId, output)

        if (!result.success) {
          return Response.json({ error: 'Step completion failed', errors: result.errors }, { status: 400 })
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
      handler: async (req) => {
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

        return Response.json(result)
      },
    })

    // POST /api/plugins/workflows/reject — reject a gate step
    ctx.registerRoute({
      path: '/reject',
      method: 'POST',
      description: 'Reject a gate step. Rewinds workflow to target step.',
      params: '{"taskId":"string","stepId":"string","reason":"string","rewindTo?":"string"}',
      handler: async (req) => {
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
      handler: async (req) => {
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
      handler: async (req) => {
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

    // POST /api/plugins/workflows/start — start a workflow for a task
    ctx.registerRoute({
      path: '/start',
      method: 'POST',
      description: 'Start a workflow instance for a task.',
      params: '{"taskId":"string","workflowId":"string"}',
      handler: async (req) => {
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
          const instance = createInstance(taskId, workflowId)
          return Response.json({ instance })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 400 })
        }
      },
    })
  },
}

export default workflowsPlugin
