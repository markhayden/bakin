/**
 * Workflow Instance + Step routes
 *
 * The agent-facing runtime surface: read the current step, submit step output
 * (advancing the workflow), list/read instances, and start a workflow for a
 * task. Handlers reach the plugin ctx via the shared accessor (start route)
 * and the search indexer; no gate-specific helpers.
 */
import { z } from 'zod'
import { createLogger } from '@bakin/core/logger'
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import { getTask, updateTask } from '../../../../src/core/task-store'
import { getCurrentStep, completeStep, listInstances, loadInstance, retryMapChild, cancelMapChild, listMapChildren, reopenFromStep } from '../runtime'
import { createValidatedInstance } from '../start-validation'
import { getWorkflowPluginContext } from '../plugin-context'
import { indexInstance } from '../search-sync'
import { triggerDispatch } from '../trigger-dispatch'
import { passthroughWf, errorResponseWf } from '../route-schemas'

const log = createLogger('workflow-routes')

// GET /steps/:taskId — get current step for a task
const getStepHandler = async (req: Request, _ctx: PluginContextLite) => {
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

// POST /steps/:taskId/complete — submit step output
const completeStepHandler = async (req: Request, ctx: PluginContextLite) => {
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
  indexInstance(taskId).catch(() => {})

  // Kick dispatch so the next step's agent starts immediately
  if (!result.workflowComplete) {
    triggerDispatch()
  }

  return Response.json(result)
}

// GET /instances/:taskId - get full instance state
const getInstanceHandler = async (req: Request, _ctx: PluginContextLite) => {
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

// POST /instances/start — start a workflow for a task
const startHandler = async (req: Request, ctx: PluginContextLite) => {
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
      assignee = getTask(taskId)?.agent
    } catch { /* best effort */ }

    const instance = await createValidatedInstance(getWorkflowPluginContext(), taskId, workflowId, assignee)

    // Ensure the task's workflowId is persisted in Bakin task metadata
    try {
      await updateTask(taskId, { workflowId })
    } catch {
      // Non-fatal — instance is created regardless
    }

    ctx.activity.audit('started', 'system', { taskId, workflowId })
    ctx.activity.log('system', `Started workflow "${workflowId}"`, { taskId })
    indexInstance(taskId).catch(() => {})

    return Response.json({ instance })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}

// Shared param plumbing for the map-child routes: the router surfaces path
// params via searchParams (see /steps/:taskId above).
const readMapChildParams = (req: Request): { taskId: string; stepId: string; index?: number } | null => {
  const url = new URL(req.url)
  const taskId = url.searchParams.get('taskId')
  const stepId = url.searchParams.get('stepId')
  if (!taskId || !stepId) return null
  const rawIndex = url.searchParams.get('index')
  const index = rawIndex === null ? undefined : Number(rawIndex)
  if (index !== undefined && !Number.isInteger(index)) return null
  return { taskId, stepId, index }
}

const listMapChildrenHandler = async (req: Request, _ctx: PluginContextLite) => {
  const params = readMapChildParams(req)
  if (!params) return Response.json({ error: 'taskId and stepId are required' }, { status: 400 })
  const result = listMapChildren(params.taskId, params.stepId)
  if (!result.success) return Response.json({ error: result.errors[0], errors: result.errors }, { status: 404 })
  return Response.json({ children: result.children })
}

const retryBodySchema = z.object({ reason: z.string().optional() }).passthrough()
const reopenBodySchema = z.object({ stepId: z.string().optional(), reason: z.string().optional() }).passthrough()

async function parseBody<T>(req: Request, schema: z.ZodType<T>, empty: T): Promise<T | null> {
  let raw: unknown
  try { raw = await req.json() } catch { return empty /* empty body is fine */ }
  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const retryMapChildHandler = async (req: Request, ctx: PluginContextLite) => {
  const params = readMapChildParams(req)
  if (!params || params.index === undefined) {
    return Response.json({ error: 'taskId, stepId, and index are required' }, { status: 400 })
  }
  const body = await parseBody(req, retryBodySchema, {})
  if (!body) return Response.json({ error: 'Invalid body — expected { reason?: string }' }, { status: 400 })

  const result = retryMapChild(params.taskId, params.stepId, params.index, { reason: body.reason })
  if (!result.success) {
    return Response.json({ error: 'Map child retry failed', errors: result.errors }, { status: 400 })
  }

  ctx.activity.audit('map_child.retried', 'user', { taskId: params.taskId, stepId: params.stepId, index: params.index, reason: body.reason })
  ctx.activity.log('user', `Retried map child ${params.index} of "${params.stepId}"`, { taskId: params.taskId })
  indexInstance(params.taskId).catch((err) => { log.warn('Failed to reindex instance after map-child retry', err) })
  triggerDispatch()
  return Response.json(result)
}

const cancelMapChildHandler = async (req: Request, ctx: PluginContextLite) => {
  const params = readMapChildParams(req)
  if (!params || params.index === undefined) {
    return Response.json({ error: 'taskId, stepId, and index are required' }, { status: 400 })
  }

  const result = cancelMapChild(params.taskId, params.stepId, params.index)
  if (!result.success) {
    return Response.json({ error: 'Map child cancel failed', errors: result.errors }, { status: 400 })
  }

  ctx.activity.audit('map_child.cancelled', 'user', { taskId: params.taskId, stepId: params.stepId, index: params.index })
  ctx.activity.log('user', `Cancelled map child ${params.index} of "${params.stepId}"`, { taskId: params.taskId })
  indexInstance(params.taskId).catch((err) => { log.warn('Failed to reindex instance after map-child cancel', err) })
  return Response.json(result)
}

// POST /instances/:taskId/reopen — reopen a workflow at a prior actionable
// step (recovery surface for failed instances, e.g. map_source_invalid).
const reopenHandler = async (req: Request, ctx: PluginContextLite) => {
  const url = new URL(req.url)
  const taskId = url.searchParams.get('taskId')
  if (!taskId) return Response.json({ error: 'taskId param required' }, { status: 400 })

  const body = await parseBody(req, reopenBodySchema, {})
  if (!body) return Response.json({ error: 'Invalid body — expected { stepId?: string, reason?: string }' }, { status: 400 })

  const result = reopenFromStep(taskId, {
    stepId: body.stepId,
    reason: body.reason || 'Reopened from task detail',
    actor: { id: 'user', source: 'web' },
  })
  if (!result.success) {
    return Response.json({ error: 'Reopen failed', errors: result.errors }, { status: 400 })
  }

  ctx.activity.audit('reopened', 'user', { taskId, stepId: result.reopenedStepId, reason: body.reason })
  ctx.activity.log('user', `Reopened workflow at "${result.reopenedStepId}"`, { taskId })
  indexInstance(taskId).catch((err) => { log.warn('Failed to reindex instance after reopen', err) })
  triggerDispatch()
  return Response.json(result)
}

export const instanceRoutes = [
  defineRoute({ path: '/steps/:taskId', method: 'GET', description: 'Get current workflow step for a task', summary: 'Get current workflow step for a task', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: getStepHandler }),
  defineRoute({ path: '/steps/:taskId/complete', method: 'POST', description: 'Submit step output, validates against schema, advances workflow', summary: 'Submit step output, validates against schema, advances workflow', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: completeStepHandler }),
  defineRoute({
    path: '/instances',
    method: 'GET',
    description: 'List active workflow instances. Optional status filter.',
    summary: 'List active workflow instances. Optional status filter.',
    responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf },
    handler: async (req: Request, _ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const status = url.searchParams.get('status') || undefined
      const instances = listInstances(status)
      return Response.json({ instances })
    },
  }),
  defineRoute({ path: '/instances/:taskId', method: 'GET', description: 'Get full workflow instance state for a task', summary: 'Get full workflow instance state for a task', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: getInstanceHandler }),
  defineRoute({ path: '/instances/start', method: 'POST', description: 'Start a workflow instance for a task', summary: 'Start a workflow instance for a task', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: startHandler }),
  defineRoute({ path: '/instances/:taskId/reopen', method: 'POST', description: 'Reopen a workflow at a prior actionable step (recovery for failed instances)', summary: 'Reopen a workflow at a prior step', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: reopenHandler }),
  defineRoute({ path: '/instances/:taskId/map/:stepId/children', method: 'GET', description: 'List a map step\'s fan-out children with live child-instance statuses', summary: 'List map children with live statuses', params: z.object({ taskId: z.string(), stepId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: listMapChildrenHandler }),
  defineRoute({ path: '/instances/:taskId/map/:stepId/children/:index/retry', method: 'POST', description: 'Retry one map child: live children reopen in place, dead ones re-create under the same child task id', summary: 'Retry a map child', params: z.object({ taskId: z.string(), stepId: z.string(), index: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: retryMapChildHandler }),
  defineRoute({ path: '/instances/:taskId/map/:stepId/children/:index/cancel', method: 'POST', description: 'Cancel one map child; the join stays blocked until it is retried or the parent is cancelled', summary: 'Cancel a map child', params: z.object({ taskId: z.string(), stepId: z.string(), index: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: cancelMapChildHandler }),
]
