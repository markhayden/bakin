/**
 * Workflows plugin — template library + runtime engine.
 * Enforces step-by-step agent execution with gated delivery,
 * parallel steps, human gates, and output validation.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { listDefinitions, loadDefinition } from './lib/parser'
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
} from './lib/runtime'
import { matchWorkflow } from './lib/matcher'
import { createLogger } from '../../src/core/logger'
import { getContentDir } from '../../src/core/content-dir'
import { validateStepOutput } from './lib/schema-validator'
import { setEventBus } from './lib/notifications'
import type { WorkflowTemplate, WorkflowDefinition, WorkflowInstance, NestedWorkflowStep } from './types'

const log = createLogger('workflows')

// ---------------------------------------------------------------------------
// Human-readable step context formatter (migrated from scripts/lib/get-step.ts)
// ---------------------------------------------------------------------------

function formatSchema(schema: Record<string, unknown>, indent = 0): string {
  const prefix = '  '.repeat(indent)
  const lines: string[] = []
  const properties = (schema.properties || schema.fields || schema) as Record<string, Record<string, unknown>>
  const required = new Set<string>((schema.required as string[]) || [])

  for (const [key, def] of Object.entries(properties)) {
    if (key === 'type' || key === 'required' || key === 'properties' || key === 'fields') continue
    const type = (def?.type as string) || 'unknown'
    const desc = (def?.description as string) || ''
    const req = required.has(key) ? ', required' : ''
    lines.push(`${prefix}- ${key} (${type}${req})${desc ? ': ' + desc : ''}`)
    if (type === 'object' && (def.properties || def.fields)) {
      lines.push(formatSchema(def as Record<string, unknown>, indent + 1))
    }
  }
  return lines.join('\n')
}

function formatStepContext(step: Record<string, unknown>): string {
  const sections: string[] = []
  sections.push(`STEP: ${step.stepId}`)
  sections.push(`STATUS: ${step.status}`)
  if (step.label) sections.push(`LABEL: ${step.label}`)
  if (step.agent) sections.push(`AGENT: ${step.agent}`)

  if (step.instructions) {
    sections.push('')
    sections.push('INSTRUCTIONS:')
    sections.push(step.instructions as string)
  }

  if (step.priorStepOutput) {
    sections.push('')
    sections.push('PRIOR STEP OUTPUT:')
    sections.push(typeof step.priorStepOutput === 'string' ? step.priorStepOutput : JSON.stringify(step.priorStepOutput, null, 2))
  } else if (!step.stepOutputs || Object.keys(step.stepOutputs as Record<string, unknown>).length === 0) {
    sections.push('')
    sections.push('PRIOR STEP OUTPUT:')
    sections.push('(none — this is the first step)')
  }

  const stepOutputs = step.stepOutputs as Record<string, unknown> | undefined
  if (stepOutputs && Object.keys(stepOutputs).length > 0) {
    sections.push('')
    sections.push('ALL PRIOR STEP OUTPUTS:')
    for (const [stepId, output] of Object.entries(stepOutputs)) {
      sections.push(`  [${stepId}]:`)
      sections.push('  ' + JSON.stringify(output, null, 2).replace(/\n/g, '\n  '))
    }
  }

  if (step.output_schema) {
    sections.push('')
    sections.push('REQUIRED OUTPUT SCHEMA:')
    sections.push(formatSchema(step.output_schema as Record<string, unknown>))
  }

  if (step.rejectionReason) {
    sections.push('')
    sections.push('REJECTION CONTEXT:')
    sections.push(step.rejectionReason as string)
    if (step.previousOutput) {
      sections.push('')
      sections.push('YOUR PREVIOUS OUTPUT (needs revision):')
      sections.push(JSON.stringify(step.previousOutput, null, 2))
    }
  } else {
    sections.push('')
    sections.push('REJECTION CONTEXT:')
    sections.push('(none — first attempt)')
  }

  return sections.join('\n')
}

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
    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerContentType({
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
      embeddingTemplate: '{{name}} {{description}} {{steps}}',
      facets: ['type', 'status'],
      reindex: async function* () {
        const contentDir = getContentDir()

        // Yield definitions
        const defsDir = join(contentDir, 'workflows', 'definitions')
        if (existsSync(defsDir)) {
          for (const file of readdirSync(defsDir).filter(f => f.endsWith('.yaml'))) {
            try {
              const name = file.replace('.yaml', '')
              const def = loadDefinition(name)
              if (def) {
                yield { key: `def:${name}`, doc: definitionToSearchDoc(name, def) }
              }
            } catch { /* skip corrupt definitions */ }
          }
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
          return existsSync(join(contentDir, 'workflows', 'definitions', `${name}.yaml`))
        }
        if (key.startsWith('inst:')) {
          const taskId = key.slice(5)
          return existsSync(join(contentDir, 'workflows', 'instances', `${taskId}.json`))
        }
        return false
      },
    })

    /** Convert a workflow definition to a search document */
    function definitionToSearchDoc(name: string, def: WorkflowDefinition): Record<string, unknown> {
      const stepsText = def.steps.map(s => `${s.id}: ${s.label || ''}`).join(', ')
      return {
        name: def.name,
        description: def.description || '',
        type: 'definition',
        status: 'active',
        task_id: '',
        steps: stepsText,
        updated_at: new Date().toISOString(),
      }
    }

    /** Convert a workflow instance to a search document */
    function instanceToSearchDoc(inst: WorkflowInstance): Record<string, unknown> {
      const def = loadDefinition(inst.workflowId)
      const stepsText = def?.steps.map(s => `${s.id}: ${s.label || ''}`).join(', ') || ''
      return {
        name: def?.name || inst.workflowId,
        description: def?.description || '',
        type: 'instance',
        status: inst.status,
        task_id: inst.taskId,
        steps: stepsText,
        updated_at: inst.updatedAt || new Date().toISOString(),
      }
    }

    /** Index a workflow instance in search */
    async function indexInstance(taskId: string): Promise<void> {
      try {
        const inst = loadInstance(taskId)
        if (inst) {
          await ctx.search.index(`inst:${taskId}`, instanceToSearchDoc(inst))
        }
      } catch (err) {
        log.warn('Failed to index workflow instance', { taskId, error: err instanceof Error ? err.message : String(err) })
      }
    }

    /** Index a workflow definition in search */
    async function indexDefinition(name: string): Promise<void> {
      try {
        const def = loadDefinition(name)
        if (def) {
          await ctx.search.index(`def:${name}`, definitionToSearchDoc(name, def))
        }
      } catch (err) {
        log.warn('Failed to index workflow definition', { name, error: err instanceof Error ? err.message : String(err) })
      }
    }

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
      indexInstance(taskId).catch(() => {})

      // Kick dispatch so the next step's agent starts immediately
      if (!result.workflowComplete) {
        triggerDispatch()
      }

      return Response.json(result)
    }
    ctx.registerRoute({ path: '/steps/:taskId/complete', method: 'POST', description: 'Submit step output, validates against schema, advances workflow', handler: completeStepHandler })


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
      indexInstance(taskId).catch(() => {})

      // Kick dispatch so the next step's agent starts immediately
      triggerDispatch()

      return Response.json(result)
    }
    ctx.registerRoute({ path: '/gates/:taskId/approve', method: 'POST', description: 'Approve a human gate step', handler: approveHandler })


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
      indexInstance(taskId).catch(() => {})

      return Response.json(result)
    }
    ctx.registerRoute({ path: '/gates/:taskId/reject', method: 'POST', description: 'Reject a gate step, rewinds workflow', handler: rejectHandler })


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

        // Ensure the task's workflowId is persisted in flow_runs
        try {
          await ctx.hooks.invoke<void>('tasks.updateTask', { identifier: taskId, updates: { workflowId } })
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
    ctx.registerRoute({ path: '/instances/start', method: 'POST', description: 'Start a workflow instance for a task', handler: startHandler })


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
      label: 'Completed workflow step',
      activityDuplicate: true,
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
        indexInstance(taskId).catch(() => {})

        if (!result.workflowComplete) {
          triggerDispatch()
        }

        return { ok: true, workflowComplete: result.workflowComplete }
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

          return { ok: true, workflowComplete: result.workflowComplete }
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
