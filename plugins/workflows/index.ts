/**
 * Workflows plugin — template library + runtime engine.
 * Enforces step-by-step agent execution with gated delivery,
 * parallel steps, human gates, and output validation.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { userInfo } from 'os'
import yaml from 'js-yaml'
import { z } from 'zod'
import type { ApprovalActor, APIRoute, BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { defineRoute, definePlugin } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import { listDefinitions, loadDefinition, validateDefinition } from './lib/parser'
import { loadDefaultWorkflows } from './lib/load-defaults'
import { workflowDefinitionSchema, listNodeTypes } from './lib/node-type-registry'
import {
  getNotificationChannel,
  listNotificationChannels,
} from './lib/notification-channel-registry'
import {
  checkWorkflowDefinitions,
  checkStaleWorkflowInstances,
  checkWorkflowSkills,
} from './lib/health-checks'
import { isReadOnly, getDefinition as getRegistryDefinition } from './lib/source-registry'
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
  authorizeWorkflowToolUse,
  isGateNotified,
  markGateNotified,
  cancelInstance,
  type GateDecisionRecord,
  type WorkflowToolUseAction,
} from './lib/runtime'
import { matchWorkflow } from './lib/matcher'
import { createLogger } from '../../src/core/logger'
import { getContentDir } from '../../src/core/content-dir'
import { getTask, updateTask } from '../../src/core/task-store'
import { validateStepOutput } from './lib/schema-validator'
import {
  getGateNotificationSettings,
  resolveGateApproval,
  sendGateDecisionSummary,
  setEventBus,
  setGateNotificationSettings,
  setNotificationRuntime,
  type GateNotificationSettings,
} from './lib/notifications'
import { approvalRefFromRecord, findPendingApprovalForGate, getApprovalRecord } from './lib/approval-store'
import { rehydratePendingApprovals } from './lib/approval-rehydration'
import type { WorkflowTemplate, WorkflowDefinition, WorkflowInstance, NestedWorkflowStep } from './types'

const log = createLogger('workflows')
let unsubscribeApprovalResponses: (() => void) | null = null

// ─── Module-scope state populated during activate() ──────────────────────
let pluginCtx: PluginContext | null = null

const passthroughWf = z.object({}).passthrough()
const errorResponseWf = z.object({ error: z.string() }).passthrough()
let gateNotificationSettings: GateNotificationSettings = {
  approvalChannelAlerts: false,
  approvalChannel: 'general',
  requireRejectReason: true,
}
function activeGateSettings(): GateNotificationSettings {
  return getGateNotificationSettings() ?? gateNotificationSettings
}

// ─── Module-scope helpers ────────────────────────────────────────────────

function resolveSubWorkflows(steps: WorkflowDefinition['steps'], subWorkflows: Record<string, WorkflowDefinition>): void {
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

function buildTemplateList(): { templates: WorkflowTemplate[]; subWorkflows: Record<string, WorkflowDefinition> } {
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
      source: d.source,
      pluginId: d.pluginId,
      packageId: d.packageId,
    }
  })
  return { templates, subWorkflows }
}

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

async function indexInstance(taskId: string): Promise<void> {
  if (!pluginCtx) return
  try {
    const inst = loadInstance(taskId)
    if (inst) {
      await pluginCtx.search.index(`inst:${taskId}`, instanceToSearchDoc(inst))
    }
  } catch (err) {
    log.warn('Failed to index workflow instance', { taskId, error: err instanceof Error ? err.message : String(err) })
  }
}

function webApprover(): ApprovalActor {
  const { username } = userInfo()
  return { source: 'web', id: username, displayName: username }
}

function getGateDescription(workflowId: string, stepId: string): string | undefined {
  const def = loadDefinition(workflowId)
  if (!def) return undefined
  const step = def.steps.find(s => s.id === stepId)
  return (step as { description?: string } | undefined)?.description
}

function buildGateAuditPayload(
  taskId: string,
  stepId: string,
  decision: GateDecisionRecord | undefined,
  reason?: string,
): Record<string, unknown> {
  return {
    taskId,
    stepId,
    gateLabel: decision?.gateLabel,
    approver: decision?.approver,
    requestedAt: decision?.requestedAt,
    decidedAt: decision?.decidedAt,
    durationMs: decision?.durationMs,
    ...(reason !== undefined ? { reason } : {}),
  }
}

function getDefinitionsDir(): string {
  return join(getContentDir(), 'workflows', 'definitions')
}

function writeUserDefinition(id: string, def: unknown): void {
  const dir = getDefinitionsDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.yaml`), yaml.dump(def), 'utf-8')
}

async function getRuntimeAgentNames(): Promise<Set<string>> {
  if (!pluginCtx) return new Set()
  const agents = await pluginCtx.runtime.agents.list()
  const names = new Set<string>()
  for (const agent of agents) {
    names.add(agent.id)
    names.add(agent.name)
  }
  return names
}

async function validateWorkflowForStart(
  workflowId: string,
  assignee: string | undefined,
  contentDir?: string,
): Promise<string[]> {
  const errors: string[] = []
  const def = loadDefinition(workflowId, contentDir)
  if (!def) {
    errors.push(`Unknown workflow id: ${workflowId}`)
    return errors
  }
  const knownAgents = await getRuntimeAgentNames()
  if (assignee && !knownAgents.has(assignee)) {
    errors.push(`Assignee "${assignee}" is not a known runtime agent`)
  }
  return errors
}

async function createValidatedInstance(
  taskId: string,
  workflowId: string,
  assignee: string | undefined,
  contentDir?: string,
  parentContext?: Record<string, unknown>,
) {
  const errors = await validateWorkflowForStart(workflowId, assignee, contentDir)
  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }
  return createInstance(taskId, workflowId, contentDir, assignee, parentContext)
}

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

function populateWorkflowRoutes(arr: any[]): void {
  arr.push(defineRoute({
    path: '/notification-channels',
    method: 'GET',
    description: 'List registered notification channels',
    summary: 'List registered notification channels',
    responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf },
    handler: async (_req: Request, ctx: PluginContextLite) => new Response(
      JSON.stringify({ channels: listNotificationChannels() }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  }))

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
        source: d.source,
        pluginId: d.pluginId,
        packageId: d.packageId,
      }
    })
    return { templates, subWorkflows }
  }

  // GET /definitions — list all workflow templates
  const listHandler = async (_req: Request, ctx: PluginContextLite) => Response.json(buildTemplateList())
  arr.push(defineRoute({ path: '/definitions', method: 'GET', description: 'List all workflow templates with step counts and resolved sub-workflows', summary: 'List all workflow templates with step counts and resolved sub-workflows', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: listHandler }))

  // GET /definitions/:name — get a specific definition with resolved sub-workflows
  const getDefinitionHandler = async (req: Request, ctx: PluginContextLite) => {
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

    return Response.json({
      definition,
      subWorkflows,
      source: definition.source,
      pluginId: definition.pluginId,
    })
  }
  arr.push(defineRoute({ path: '/definitions/:name', method: 'GET', description: 'Get a specific workflow definition by name', summary: 'Get a specific workflow definition by name', params: z.object({ name: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: getDefinitionHandler }))

  // ─── CRUD Routes (user definitions only) ──────────────────────────
  // User YAML files live at ~/.bakin/workflows/definitions/{id}.yaml.
  // Plugin-shipped definitions are read-only — POST refuses to overwrite
  // a plugin-owned id, DELETE refuses to remove a plugin-only id with no
  // user shadow. PUT always writes to disk (creating a shadow if needed)
  // because the user-wins rule lets a user override a plugin definition.

  const getDefinitionsDir = (): string => join(getContentDir(), 'workflows', 'definitions')

  const writeUserDefinition = (id: string, def: unknown): void => {
    const dir = getDefinitionsDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.yaml`), yaml.dump(def), 'utf-8')
  }

  // POST /definitions — create a new user-owned workflow YAML
  const createDefinitionHandler = async (req: Request, ctx: PluginContextLite) => {
    let body: { id?: string; [k: string]: unknown }
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const id = typeof body.id === 'string' ? body.id : undefined
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    // Refuse to overwrite a plugin-only id (no user shadow yet)
    if (isReadOnly(id)) {
      const entry = getRegistryDefinition(id)
      return Response.json(
        { error: `Workflow id "${id}" is owned by plugin "${entry?.pluginId ?? 'unknown'}" — POST refuses to overwrite. Use PUT to create a user shadow.` },
        { status: 409 },
      )
    }

    const rest = { ...body }
    delete rest.id
    const parsed = workflowDefinitionSchema.safeParse(rest)
    if (!parsed.success) {
      return Response.json(
        { error: 'validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const definition = parsed.data as WorkflowDefinition
    const semanticErrors = validateDefinition(definition, {
      definitionId: id,
      source: 'user',
      knownWorkflowIds: new Set([...listDefinitions().map((entry) => entry.name), id]),
    })
    if (semanticErrors.length > 0) {
      return Response.json(
        { error: 'validation failed', errors: semanticErrors },
        { status: 400 },
      )
    }

    writeUserDefinition(id, definition)
    return Response.json({ id, source: 'user', definition }, { status: 201 })
  }
  arr.push(defineRoute({ path: '/definitions', method: 'POST', description: 'Create a new user-owned workflow definition', summary: 'Create a new user-owned workflow definition', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: createDefinitionHandler }))

  // PUT /definitions/:name — update or create a user-owned workflow YAML
  const updateDefinitionHandler = async (req: Request, ctx: PluginContextLite) => {
    const url = new URL(req.url)
    const name = url.searchParams.get('name')
    if (!name) {
      return Response.json({ error: 'name param required' }, { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const rest = { ...body }
    delete rest.id
    const parsed = workflowDefinitionSchema.safeParse(rest)
    if (!parsed.success) {
      return Response.json(
        { error: 'validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const definition = parsed.data as WorkflowDefinition
    const semanticErrors = validateDefinition(definition, {
      definitionId: name,
      source: 'user',
      knownWorkflowIds: new Set([...listDefinitions().map((entry) => entry.name), name]),
    })
    if (semanticErrors.length > 0) {
      return Response.json(
        { error: 'validation failed', errors: semanticErrors },
        { status: 400 },
      )
    }

    writeUserDefinition(name, definition)
    return Response.json({ id: name, source: 'user', definition })
  }
  arr.push(defineRoute({ path: '/definitions/:name', method: 'PUT', description: 'Update or shadow a workflow definition (writes user YAML)', summary: 'Update or shadow a workflow definition (writes user YAML)', params: z.object({ name: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: updateDefinitionHandler }))

  // DELETE /definitions/:name — remove the user-owned YAML for this id
  const deleteDefinitionHandler = async (req: Request, ctx: PluginContextLite) => {
    const url = new URL(req.url)
    const name = url.searchParams.get('name')
    if (!name) {
      return Response.json({ error: 'name param required' }, { status: 400 })
    }

    const dir = getDefinitionsDir()
    const yamlPath = join(dir, `${name}.yaml`)
    const ymlPath = join(dir, `${name}.yml`)
    const existing = existsSync(yamlPath) ? yamlPath : existsSync(ymlPath) ? ymlPath : null

    if (!existing) {
      // No user file. If plugin owns this id, the user is trying to delete
      // something they don't own — return 409 so the UI can explain.
      if (isReadOnly(name)) {
        const entry = getRegistryDefinition(name)
        return Response.json(
          { error: `Workflow id "${name}" is owned by plugin "${entry?.pluginId ?? 'unknown'}" — cannot delete. Edit the plugin or shadow it with PUT.` },
          { status: 409 },
        )
      }
      return Response.json({ error: 'Definition not found' }, { status: 404 })
    }

    unlinkSync(existing)
    return Response.json({ id: name, deleted: true })
  }
  arr.push(defineRoute({ path: '/definitions/:name', method: 'DELETE', description: 'Delete a user-owned workflow definition', summary: 'Delete a user-owned workflow definition', params: z.object({ name: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: deleteDefinitionHandler }))

  // GET /node-types — palette data source. Returns the registered node-type
  // metadata (builtin + plugin-registered) minus the Zod schemas (which
  // aren't JSON-serializable). The canvas-editor palette hydrates from this.
  const nodeTypesHandler = async (_req: Request, ctx: PluginContextLite) => {
    const items = listNodeTypes().map((def) => ({
      kind: def.kind,
      runtime: def.runtime,
      pluginId: def.pluginId,
      edgeRules: def.edgeRules,
      formFields: def.formFields,
    }))
    return Response.json({ nodeTypes: items })
  }
  arr.push(defineRoute({ path: '/node-types', method: 'GET', description: 'List registered workflow node types (builtin + plugin-registered) for the canvas palette', summary: 'List registered workflow node types (builtin + plugin-registered) for the canvas palette', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: nodeTypesHandler }))

  // ─── Runtime Routes ───────────────────────────────────────────────

  // GET /steps/:taskId — get current step for a task
  const getStepHandler = async (req: Request, ctx: PluginContextLite) => {
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
  arr.push(defineRoute({ path: '/steps/:taskId', method: 'GET', description: 'Get current workflow step for a task', summary: 'Get current workflow step for a task', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: getStepHandler }))

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
  arr.push(defineRoute({ path: '/steps/:taskId/complete', method: 'POST', description: 'Submit step output, validates against schema, advances workflow', summary: 'Submit step output, validates against schema, advances workflow', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: completeStepHandler }))


  // Web-source approver: REST endpoints come from the Bakin UI, which is
  // single-user behind Tailscale. Use the OS username so audit trails can
  // identify who clicked the button with at least machine-level granularity.
  const webApprover = (): ApprovalActor => {
    const { username } = userInfo()
    return { source: 'web', id: username, displayName: username }
  }

  // Resolve a gate's description from its workflow definition for the
  // decision summary. Returns undefined if the workflow or step can't be
  // loaded; the summary will simply omit the description.
  const getGateDescription = (workflowId: string, stepId: string): string | undefined => {
    const def = loadDefinition(workflowId)
    if (!def) return undefined
    const step = def.steps.find(s => s.id === stepId)
    return (step as { description?: string } | undefined)?.description
  }

  // Build the structured audit payload for gate.approved / gate.rejected.
  // The decision record is the source of truth — approver, gateLabel,
  // timestamps, durationMs all flow through it.
  const buildGateAuditPayload = (
    taskId: string,
    stepId: string,
    decision: GateDecisionRecord | undefined,
    reason?: string,
  ): Record<string, unknown> => ({
    taskId,
    stepId,
    gateLabel: decision?.gateLabel,
    approver: decision?.approver,
    requestedAt: decision?.requestedAt,
    decidedAt: decision?.decidedAt,
    durationMs: decision?.durationMs,
    ...(reason !== undefined ? { reason } : {}),
  })

  // POST /gates/:taskId/approve — approve a gate step
  const approveHandler = async (req: Request, ctx: PluginContextLite) => {
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

    // Capture rendered approval reference before approval changes state.
    const preInstance = loadInstance(taskId)
    const approvalRef = approvalRefFromRecord(findPendingApprovalForGate(taskId, stepId))
      ?? preInstance?.stepStates[stepId]?.approvalRef

    const approver = webApprover()
    const result = approveGate(taskId, stepId, { approver })

    if (!result.success) {
      return Response.json({ error: result.errors?.[0], errors: result.errors }, { status: 400 })
    }

    ctx.activity.audit('gate.approved', 'web', buildGateAuditPayload(taskId, stepId, result.decision))
    ctx.activity.log('web', `Gate "${stepId}" approved`, { taskId })
    indexInstance(taskId).catch(() => {})

    // Kick dispatch so the next step's agent starts immediately
    triggerDispatch()

    // Sync rendered approval + summary when channel alerts are enabled.
    const settings = activeGateSettings()
    if (settings.approvalChannelAlerts && result.decision) {
      const instance = loadInstance(taskId)
      resolveGateApproval(
        approvalRef,
        'approved',
        approver,
        result.decision.decidedAt,
      ).catch(() => {})
      if (instance) {
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
          settings,
        ).catch(() => {})
      }
    }

    return Response.json(result)
  }
  arr.push(defineRoute({ path: '/gates/:taskId/approve', method: 'POST', description: 'Approve a human gate step', summary: 'Approve a human gate step', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: approveHandler }))


  // POST /gates/:taskId/reject — reject a gate step
  const rejectHandler = async (req: Request, ctx: PluginContextLite) => {
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

    // Capture rendered approval reference before rejection changes state.
    const preInstance = loadInstance(taskId)
    const approvalRef = approvalRefFromRecord(findPendingApprovalForGate(taskId, stepId))
      ?? preInstance?.stepStates[stepId]?.approvalRef

    const approver = webApprover()
    const result = rejectGate(taskId, stepId, reason, { rewindTo, approver })

    if (!result.success) {
      return Response.json({ error: result.errors?.[0], errors: result.errors }, { status: 400 })
    }

    ctx.activity.audit('gate.rejected', 'web', buildGateAuditPayload(taskId, stepId, result.decision, reason))
    ctx.activity.log('web', `Gate "${stepId}" rejected: ${reason}`, { taskId })
    indexInstance(taskId).catch(() => {})

    // Sync rendered approval + summary when channel alerts are enabled.
    const settings = activeGateSettings()
    if (settings.approvalChannelAlerts && result.decision) {
      const instance = loadInstance(taskId)
      resolveGateApproval(
        approvalRef,
        'rejected',
        approver,
        result.decision.decidedAt,
        reason,
      ).catch(() => {})
      if (instance) {
        sendGateDecisionSummary(
          instance,
          stepId,
          result.decision.gateLabel,
          getGateDescription(instance.workflowId, stepId),
          'rejected',
          approver,
          result.decision.requestedAt,
          result.decision.decidedAt,
          reason,
          settings,
        ).catch(() => {})
      }
    }

    return Response.json(result)
  }
  arr.push(defineRoute({ path: '/gates/:taskId/reject', method: 'POST', description: 'Reject a gate step, rewinds workflow', summary: 'Reject a gate step, rewinds workflow', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: rejectHandler }))

  const gateDecisionPageHandler = async (req: Request, ctx: PluginContextLite) => {
    const url = new URL(req.url)
    const taskId = url.searchParams.get('taskId')
    const stepId = url.searchParams.get('stepId')
    const approvalId = url.searchParams.get('approvalId')
    if (!taskId || !stepId || !approvalId) {
      return gateDecisionHtmlResponse('Approval Link Error', '<p>taskId, stepId, and approvalId are required.</p>', 400)
    }

    const approvalRecord = getApprovalRecord(approvalId)
    if (!approvalRecord || approvalRecord.owner.taskId !== taskId || approvalRecord.owner.stepId !== stepId) {
      return gateDecisionHtmlResponse('Approval Not Found', '<p>This approval link no longer matches a pending workflow gate.</p>', 404)
    }

    const escapedTitle = escapeHtml(approvalRecord.request.title)
    const escapedBody = escapeHtml(approvalRecord.request.body)
    const statusText = approvalRecord.status === 'pending'
      ? ''
      : `<p class="notice">This approval has already been marked ${escapeHtml(approvalRecord.status)}.</p>`
    const disabled = approvalRecord.status === 'pending' ? '' : ' disabled'
    return gateDecisionHtmlResponse(approvalRecord.request.title, `
      <p class="eyebrow">Workflow Approval</p>
      <h1>${escapedTitle}</h1>
      <pre>${escapedBody}</pre>
      ${statusText}
      <form method="POST">
        <input type="hidden" name="approvalId" value="${escapeHtml(approvalId)}" />
        <input type="hidden" name="taskId" value="${escapeHtml(taskId)}" />
        <input type="hidden" name="stepId" value="${escapeHtml(stepId)}" />
        <button name="decision" value="approve"${disabled}>Approve</button>
      </form>
      <form method="POST">
        <input type="hidden" name="approvalId" value="${escapeHtml(approvalId)}" />
        <input type="hidden" name="taskId" value="${escapeHtml(taskId)}" />
        <input type="hidden" name="stepId" value="${escapeHtml(stepId)}" />
        <label for="reason">Reject reason</label>
        <textarea id="reason" name="reason" rows="4"${disabled}></textarea>
        <button class="danger" name="decision" value="reject"${disabled}>Reject</button>
      </form>
    `)
  }
  arr.push(defineRoute({ path: '/gates/:taskId/decision', method: 'GET', description: 'Render a durable Bakin gate approval fallback page', summary: 'Render a durable Bakin gate approval fallback page', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: gateDecisionPageHandler }))

  const gateDecisionActionHandler = async (req: Request, ctx: PluginContextLite) => {
    const url = new URL(req.url)
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return gateDecisionHtmlResponse('Approval Link Error', '<p>Invalid form submission.</p>', 400)
    }

    const taskId = url.searchParams.get('taskId') || formValue(form, 'taskId')
    const stepId = url.searchParams.get('stepId') || formValue(form, 'stepId')
    const approvalId = url.searchParams.get('approvalId') || formValue(form, 'approvalId')
    const decision = formValue(form, 'decision')
    if (!taskId || !stepId || !approvalId || !decision) {
      return gateDecisionHtmlResponse('Approval Link Error', '<p>taskId, stepId, approvalId, and decision are required.</p>', 400)
    }

    const approvalRecord = getApprovalRecord(approvalId)
    if (!approvalRecord || approvalRecord.owner.taskId !== taskId || approvalRecord.owner.stepId !== stepId) {
      return gateDecisionHtmlResponse('Approval Not Found', '<p>This approval link no longer matches a pending workflow gate.</p>', 404)
    }
    if (approvalRecord.status !== 'pending') {
      return gateDecisionHtmlResponse('Approval Already Decided', `<p>This approval is already ${escapeHtml(approvalRecord.status)}.</p>`)
    }

    const approvalRef = approvalRefFromRecord(approvalRecord)
    const approver = webApprover()
    if (decision === 'approve') {
      const result = approveGate(taskId, stepId, { approver })
      if (!result.success) {
        return gateDecisionHtmlResponse('Approval Failed', `<p>${escapeHtml(result.errors?.[0] || 'Unknown approval failure')}</p>`, 400)
      }

      ctx.activity.audit('gate.approved', 'web', buildGateAuditPayload(taskId, stepId, result.decision))
      ctx.activity.log('web', `Gate "${stepId}" approved from approval link`, { taskId })
      indexInstance(taskId).catch(() => {})
      triggerDispatch()

      const settings = activeGateSettings()
      const instance = loadInstance(taskId)
      if (settings.approvalChannelAlerts && result.decision && instance) {
        resolveGateApproval(approvalRef, 'approved', approver, result.decision.decidedAt).catch(() => {})
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
          settings,
        ).catch(() => {})
      }

      return gateDecisionHtmlResponse('Gate Approved', '<p>The workflow gate was approved. You can close this tab.</p>')
    }

    if (decision === 'reject') {
      const reason = formValue(form, 'reason')?.trim()
      if (!reason) {
        return gateDecisionHtmlResponse('Reject Reason Required', '<p>A reject reason is required.</p>', 400)
      }

      const result = rejectGate(taskId, stepId, reason, { approver })
      if (!result.success) {
        return gateDecisionHtmlResponse('Reject Failed', `<p>${escapeHtml(result.errors?.[0] || 'Unknown rejection failure')}</p>`, 400)
      }

      ctx.activity.audit('gate.rejected', 'web', buildGateAuditPayload(taskId, stepId, result.decision, reason))
      ctx.activity.log('web', `Gate "${stepId}" rejected from approval link: ${reason}`, { taskId })
      indexInstance(taskId).catch(() => {})

      const settings = activeGateSettings()
      const instance = loadInstance(taskId)
      if (settings.approvalChannelAlerts && result.decision && instance) {
        resolveGateApproval(approvalRef, 'rejected', approver, result.decision.decidedAt, reason).catch(() => {})
        sendGateDecisionSummary(
          instance,
          stepId,
          result.decision.gateLabel,
          getGateDescription(instance.workflowId, stepId),
          'rejected',
          approver,
          result.decision.requestedAt,
          result.decision.decidedAt,
          reason,
          settings,
        ).catch(() => {})
      }

      return gateDecisionHtmlResponse('Gate Rejected', '<p>The workflow gate was rejected. You can close this tab.</p>')
    }

    return gateDecisionHtmlResponse('Approval Link Error', '<p>decision must be approve or reject.</p>', 400)
  }
  arr.push(defineRoute({ path: '/gates/:taskId/decision', method: 'POST', description: 'Approve or reject a gate through the durable Bakin approval fallback page', summary: 'Approve or reject a gate through the durable Bakin approval fallback page', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: gateDecisionActionHandler }))


  // GET /instances — list active workflow instances
  arr.push(defineRoute({
    path: '/instances',
    method: 'GET',
    description: 'List active workflow instances. Optional status filter.',
    summary: 'List active workflow instances. Optional status filter.',
    responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const status = url.searchParams.get('status') || undefined
      const instances = listInstances(status)
      return Response.json({ instances })
    },
  }))

  // GET /instances/:taskId ��� get full instance state
  const getInstanceHandler = async (req: Request, ctx: PluginContextLite) => {
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
  arr.push(defineRoute({ path: '/instances/:taskId', method: 'GET', description: 'Get full workflow instance state for a task', summary: 'Get full workflow instance state for a task', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: getInstanceHandler }))


  // GET /gates/pending — list all gates awaiting approval
  const pendingGatesHandler = async (_req: Request, ctx: PluginContextLite) => {
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
  arr.push(defineRoute({ path: '/gates/pending', method: 'GET', description: 'List all gates awaiting approval', summary: 'List all gates awaiting approval', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: pendingGatesHandler }))


  // GET /gates/status — batch check gate status for tasks
  const gateStatusHandler = async (req: Request, ctx: PluginContextLite) => {
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
  arr.push(defineRoute({ path: '/gates/status', method: 'GET', description: 'Batch check gate status for tasks', summary: 'Batch check gate status for tasks', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: gateStatusHandler }))


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

      const instance = await createValidatedInstance(taskId, workflowId, assignee)

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
  arr.push(defineRoute({ path: '/instances/start', method: 'POST', description: 'Start a workflow instance for a task', summary: 'Start a workflow instance for a task', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: startHandler }))

}

// Static array — populated by populateWorkflowRoutes() at module load.
const workflowRoutes: any[] = []
populateWorkflowRoutes(workflowRoutes)

const workflowsPlugin: BakinPlugin = definePlugin({
  routes: workflowRoutes as unknown as Parameters<typeof definePlugin>[0]['routes'],
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
    // Reset routes on every activate (hot-reload safety).
    workflowRoutes.length = 0

    // ─── Search Content Type Registration ─────────────────────────────

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
            return def ? definitionToSearchDoc(name, def) : null
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
      reindex: async function* () {
        const contentDir = getContentDir()

        // Yield definitions
        const defsDir = join(contentDir, 'workflows', 'definitions')
        if (existsSync(defsDir)) {
          for (const file of readdirSync(defsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))) {
            try {
              const name = file.replace(/\.(yaml|yml)$/, '')
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
            || existsSync(join(contentDir, 'workflows', 'definitions', `${name}.yml`))
        }
        if (key.startsWith('inst:')) {
          const taskId = key.slice(5)
          return existsSync(join(contentDir, 'workflows', 'instances', `${taskId}.json`))
        }
        return false
      },
    })

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
    const gateNotificationSettings: GateNotificationSettings = {
      approvalChannelAlerts: pluginSettings.approvalChannelAlerts as boolean ?? false,
      approvalChannel: pluginSettings.approvalChannel as string ?? 'general',
      requireRejectReason: pluginSettings.requireRejectReason as boolean ?? true,
    }
    setGateNotificationSettings(gateNotificationSettings)
    const activeGateSettings = () => getGateNotificationSettings() ?? gateNotificationSettings

    const getRuntimeAgentNames = async (): Promise<Set<string>> => {
      const agents = await ctx.runtime.agents.list()
      const names = new Set<string>()
      for (const agent of agents) {
        names.add(agent.id)
        names.add(agent.name)
      }
      return names
    }

    const collectNestedWorkflowIds = (def: WorkflowDefinition, out: Set<string>): void => {
      for (const step of def.steps) {
        if (step.type === 'workflow') {
          out.add((step as NestedWorkflowStep).workflow_id)
        }
      }
    }

    const validateWorkflowForStart = async (
      workflowId: string,
      assignee: string | undefined,
      contentDir?: string,
    ): Promise<string[]> => {
      const errors: string[] = []
      const runtimeAgents = await getRuntimeAgentNames()
      const knownWorkflowIds = new Set(listDefinitions(contentDir).map((entry) => entry.name))
      const visited = new Set<string>()

      const visit = (id: string, path: string[]): void => {
        if (path.includes(id)) {
          errors.push(`Workflow nesting cycle detected: ${[...path, id].join(' -> ')}`)
          return
        }
        if (visited.has(id)) return
        visited.add(id)

        const def = loadDefinition(id, contentDir)
        if (!def) {
          errors.push(`Workflow definition not found: ${id}`)
          return
        }

        errors.push(...validateDefinition(def, {
          definitionId: id,
          source: def.source,
          contentDir,
          knownWorkflowIds,
          runtimeAgents,
          assignee,
          requireResolvedAgents: true,
        }).map((message) => `Workflow "${id}": ${message}`))

        const nestedIds = new Set<string>()
        collectNestedWorkflowIds(def, nestedIds)
        for (const nestedId of nestedIds) visit(nestedId, [...path, id])
      }

      visit(workflowId, [])

      return errors
    }

    const createValidatedInstance = async (
      taskId: string,
      workflowId: string,
      assignee: string | undefined,
      contentDir?: string,
      parentContext?: Record<string, unknown>,
    ) => {
      const errors = await validateWorkflowForStart(workflowId, assignee, contentDir)
      if (errors.length > 0) {
        throw new Error(errors.join('; '))
      }
      return createInstance(taskId, workflowId, contentDir, assignee, parentContext)
    }

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
    ctx.hooks.register('workflows.createInstance', (d: Record<string, unknown>) => createValidatedInstance(d.taskId as string, d.workflowId as string, d.assignee as string | undefined, d.contentDir as string | undefined, d.parentContext as Record<string, unknown> | undefined), { label: 'Create workflow instance.', summary: 'Creates a workflow instance for a task and optional assignee context. Use it when task creation or routing should immediately attach a workflow.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.instances.list', (d: Record<string, unknown>) => listInstances(d.statusFilter as string | undefined, d.contentDir as string | undefined), { label: 'List workflow instances.', summary: 'Returns workflow instances, optionally filtered by status. Use it for dashboards, queues, and maintenance flows that need a broad view of active workflow state.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.getCurrentStep', (d: Record<string, unknown>) => getCurrentStep(d.taskId as string, d.agentId as string | undefined, d.contentDir as string | undefined), { label: 'Get current step.', summary: 'Returns the current workflow step for a task, optionally scoped to an agent. Use it when a plugin needs to know what work is currently actionable.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.completeStep', (d: Record<string, unknown>) => completeStep(d.taskId as string, d.stepId as string, d.output as Record<string, unknown>, d.callerAgentId as string | undefined, d.contentDir as string | undefined), { label: 'Complete workflow step.', summary: 'Submits output for a workflow step and advances the instance when validation passes. Use it from agents or tools that finish a workflow action.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.matchWorkflow', (d: Record<string, unknown>) => matchWorkflow(d.title as string, d.description as string | undefined), { label: 'Match workflow.', summary: 'Suggests a workflow based on a task title and description. Use it when creating tasks that should automatically pick the most relevant workflow template.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.definitions.list', (d: Record<string, unknown>) => listDefinitions(d.contentDir as string | undefined), { label: 'List workflow definitions.', summary: 'Returns available workflow definitions from the configured content directory. Use it to populate workflow selectors or validate workflow ids before creating instances.', hookKind: 'rpc' })
    ctx.hooks.register('workflows.loadDefinition', (d: Record<string, unknown>) => loadDefinition(d.name as string, d.contentDir as string | undefined), { label: 'Load workflow definition.', summary: 'Loads one workflow definition by name. Use it when a plugin needs the template shape, steps, or metadata behind a workflow id.', hookKind: 'rpc' })
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
      autoFix: true,
      run: () => checkStaleWorkflowInstances(getContentDir()),
    })
    ctx.registerHealthCheck({
      id: 'skills',
      name: 'Workflow skills validation',
      run: async () => checkWorkflowSkills(getContentDir()),
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

          const instance = await createValidatedInstance(taskId, workflowId, assignee)

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

function formValue(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function gateDecisionHtmlResponse(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f10; color: #f2f2f3; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(720px, 100%); border: 1px solid #2b2b2f; border-radius: 8px; background: #151517; padding: 24px; }
    h1 { margin: 0 0 16px; font-size: 24px; line-height: 1.2; }
    pre { white-space: pre-wrap; word-break: break-word; color: #c6c6cc; background: #101012; border: 1px solid #29292d; border-radius: 6px; padding: 16px; }
    form { margin-top: 16px; display: grid; gap: 10px; }
    label, .eyebrow { color: #8f8f98; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    textarea { resize: vertical; border-radius: 6px; border: 1px solid #35353a; background: #101012; color: #f2f2f3; padding: 10px; font: inherit; }
    button { width: fit-content; border: 0; border-radius: 6px; background: #2f6fed; color: white; padding: 10px 14px; font: inherit; font-weight: 700; cursor: pointer; }
    button.danger { background: #b42318; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .notice { color: #f6c343; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export default workflowsPlugin
