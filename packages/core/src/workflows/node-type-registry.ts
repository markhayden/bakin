/**
 * Node-type registry — single source of truth for the workflow step type system.
 *
 * Every step in a workflow definition belongs to a node type. Each node type
 * exposes a Zod schema that validates its shape AND form-field metadata that
 * drives the UI editor. The two share one definition so the form editor and
 * the YAML loader cannot drift.
 *
 * Builtins self-register at module load with `runtime: 'builtin'`. Plugins
 * register their own node types via `ctx.registerNodeType()`, which calls
 * `registerPluginNodeType()` here. Plugin kinds are auto-namespaced as
 * `{pluginId}.{kind}` to avoid cross-plugin collisions.
 */
import { z } from 'zod'

// ─── Public types ───────────────────────────────────────────────────────────

export type NodeRuntime = 'builtin' | 'plugin'

export type FormFieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'agent'
  | 'skill'
  | 'list'

export interface FormField {
  name: string
  type: FormFieldType
  required?: boolean
  description?: string
  options?: { value: string; label: string }[]
}

/**
 * Edge connection rules consumed by the canvas editor's onConnect validator.
 * `undefined` = unlimited. `0` = forbidden.
 */
export interface EdgeRules {
  maxInbound?: number
  maxOutbound?: number
}

export interface NodeTypeDef<T = unknown> {
  kind: string
  runtime: NodeRuntime
  zodSchema: z.ZodType<T>
  formFields: FormField[]
  edgeRules?: EdgeRules
  /** Set when runtime === 'plugin'; identifies the owning plugin. */
  pluginId?: string
}

// ─── Registry ───────────────────────────────────────────────────────────────

const registry = new Map<string, NodeTypeDef>()

export function registerNodeType<T>(def: NodeTypeDef<T>): void {
  if (registry.has(def.kind)) {
    throw new Error(`Node type "${def.kind}" is already registered`)
  }
  registry.set(def.kind, def as NodeTypeDef)
}

export function getNodeType(kind: string): NodeTypeDef | undefined {
  return registry.get(kind)
}

export function listNodeTypes(): NodeTypeDef[] {
  return Array.from(registry.values())
}

/**
 * Remove a registration. Used at plugin teardown (hot reload) to drop the
 * plugin's node types so re-activation doesn't throw "already registered".
 */
export function unregisterNodeType(kind: string): void {
  registry.delete(kind)
}

// ─── Plugin-side registration helper ────────────────────────────────────────

/** The subset of NodeTypeDef a plugin supplies — no pluginId/runtime (derived). */
export interface PluginNodeTypeInput<T = unknown> {
  kind: string
  zodSchema: z.ZodType<T>
  formFields: FormField[]
  edgeRules?: EdgeRules
}

const AGENT_STYLE_EDGE_RULES: EdgeRules = { maxOutbound: 1 }

/**
 * Register a plugin-owned node type. The kind is auto-namespaced to
 * `{pluginId}.{kind}` so two plugins can ship the same unprefixed kind
 * without colliding. Returns the namespaced kind so callers can wire hooks.
 */
export function registerPluginNodeType<T>(
  pluginId: string,
  def: PluginNodeTypeInput<T>,
): string {
  const namespacedKind = `${pluginId}.${def.kind}`
  registerNodeType({
    kind: namespacedKind,
    runtime: 'plugin',
    pluginId,
    zodSchema: def.zodSchema,
    formFields: def.formFields,
    edgeRules: def.edgeRules ?? AGENT_STYLE_EDGE_RULES,
  })
  return namespacedKind
}

/** Remove every node type owned by a plugin. */
export function unregisterPluginNodeTypes(pluginId: string): void {
  for (const [kind, def] of registry.entries()) {
    if (def.runtime === 'plugin' && def.pluginId === pluginId) {
      registry.delete(kind)
    }
  }
}

/**
 * True when `kind` is a registered plugin-owned node type. Used by the
 * workflow runtime to decide between the builtin dispatch branches and
 * the `workflows.executeNode.{kind}` hook fallback.
 */
export function isPluginKind(kind: string): boolean {
  return registry.get(kind)?.runtime === 'plugin'
}

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

const stepOutputSchema = z.object({
  id: z.string(),
  type: z.enum(['string', 'file', 'number']).optional(),
  path: z.string().optional(),
}).passthrough()

const notifyChannelSchema = z.object({
  channel: z.string().min(1),
  target: z.string(),
}).passthrough()

// ─── Builtin step schemas ───────────────────────────────────────────────────

export const agentStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('agent'),
  label: z.string().min(1),
  agent: z.string().min(1),
  task: z.string().optional(),
  skill: z.string().optional(),
  description: z.string().optional(),
  outputs: z.array(stepOutputSchema).optional(),
  deny_tools: z.array(z.string()).optional(),
}).passthrough()

export const gateStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('gate'),
  label: z.string().min(1),
  description: z.string().optional(),
  approval_required: z.boolean().optional(),
  notify: z.array(notifyChannelSchema).optional(),
  preview: z.array(z.string()).optional(),
  on_reject: z
    .object({
      goto: z.string(),
      note_to_agent: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough()

export const outputStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('output'),
  label: z.string().min(1),
  agent: z.string().optional(),
  skill: z.string().optional(),
  description: z.string().optional(),
  channels: z.array(z.string()).optional(),
  content: z.record(z.string(), z.string()).optional(),
  schedule: z.string().optional(),
  deny_tools: z.array(z.string()).optional(),
}).passthrough()

export const nestedWorkflowStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('workflow'),
  label: z.string().min(1),
  workflow_id: z.string().min(1),
  description: z.string().optional(),
}).passthrough()

const taskSourceSchema = z.object({
  pluginId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  purpose: z.string().optional(),
}).passthrough()

export const createTaskStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('createTask'),
  label: z.string().min(1),
  taskId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  agent: z.string().optional(),
  column: z.string().optional(),
  workflowId: z.string().optional(),
  parentId: z.string().optional(),
  projectId: z.string().optional(),
  availableAt: z.string().optional(),
  dueAt: z.string().optional(),
  source: taskSourceSchema.optional(),
  skipWorkflowReason: z.string().optional(),
}).passthrough()

// Parallel children are agent steps only — the semantic validator has always
// rejected non-agent children; the schema now says the same thing.
const parallelChildSchema = agentStepSchema

export const parallelStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('parallel'),
  label: z.string().min(1),
  steps: z.array(parallelChildSchema).min(1),
}).passthrough()

// ─── Builtin form-field metadata (drives the editor UI) ─────────────────────

const agentFormFields: FormField[] = [
  { name: 'agent', type: 'agent', required: true, description: 'Agent that runs this step' },
  { name: 'skill', type: 'skill', description: 'Optional skill instructions to inject' },
  { name: 'task', type: 'text', description: 'One-line task description' },
  { name: 'description', type: 'text', description: 'Long-form description' },
  { name: 'deny_tools', type: 'list', description: 'Tool names this step may not call' },
]

const gateFormFields: FormField[] = [
  { name: 'description', type: 'text' },
  { name: 'approval_required', type: 'boolean' },
  { name: 'on_reject', type: 'string', description: 'Step id to fall back to on rejection' },
  { name: 'preview', type: 'list', description: 'Output keys to show in the gate preview' },
]

const parallelFormFields: FormField[] = [
  { name: 'steps', type: 'list', required: true, description: 'Child steps run in parallel' },
]

const outputFormFields: FormField[] = [
  { name: 'agent', type: 'agent' },
  { name: 'skill', type: 'skill' },
  { name: 'channels', type: 'list', description: 'Runtime channel IDs (e.g. general, announcements)' },
  { name: 'content', type: 'text', description: 'Content map (key → value)' },
  { name: 'schedule', type: 'string', description: 'Cron expression for recurring outputs' },
]

const nestedWorkflowFormFields: FormField[] = [
  { name: 'workflow_id', type: 'string', required: true, description: 'Id of the workflow to invoke' },
  { name: 'description', type: 'text' },
]

const createTaskFormFields: FormField[] = [
  { name: 'title', type: 'string', required: true, description: 'Task title' },
  { name: 'description', type: 'text', description: 'Task description' },
  { name: 'agent', type: 'agent', description: 'Agent to assign' },
  { name: 'column', type: 'select', description: 'Initial task column', options: [
    { value: 'todo', label: 'Todo' },
    { value: 'backlog', label: 'Backlog' },
  ] },
  { name: 'workflowId', type: 'string', description: 'Workflow to attach to the created task' },
  { name: 'availableAt', type: 'string', description: 'ISO timestamp before which dispatch must not pick up the task' },
  { name: 'dueAt', type: 'string', description: 'ISO deadline or target delivery time' },
]

// ─── Self-registration of builtins ──────────────────────────────────────────

registerNodeType({
  kind: 'agent',
  runtime: 'builtin',
  zodSchema: agentStepSchema,
  formFields: agentFormFields,
  edgeRules: { maxOutbound: 1 },
})
registerNodeType({
  kind: 'gate',
  runtime: 'builtin',
  zodSchema: gateStepSchema,
  formFields: gateFormFields,
  edgeRules: { maxOutbound: 1 },
})
registerNodeType({
  kind: 'parallel',
  runtime: 'builtin',
  zodSchema: parallelStepSchema,
  formFields: parallelFormFields,
  edgeRules: { maxOutbound: 1 },
})
registerNodeType({
  kind: 'output',
  runtime: 'builtin',
  zodSchema: outputStepSchema,
  formFields: outputFormFields,
  edgeRules: { maxOutbound: 0 },
})
registerNodeType({
  kind: 'workflow',
  runtime: 'builtin',
  zodSchema: nestedWorkflowStepSchema,
  formFields: nestedWorkflowFormFields,
  edgeRules: { maxOutbound: 1 },
})
registerNodeType({
  kind: 'createTask',
  runtime: 'builtin',
  zodSchema: createTaskStepSchema,
  formFields: createTaskFormFields,
  edgeRules: { maxOutbound: 1 },
})

// ─── Top-level workflow schema ──────────────────────────────────────────────

const BUILTIN_KINDS = new Set(['agent', 'gate', 'parallel', 'output', 'workflow', 'createTask'])

const builtinStepSchema = z.discriminatedUnion('type', [
  agentStepSchema,
  gateStepSchema,
  parallelStepSchema,
  outputStepSchema,
  nestedWorkflowStepSchema,
  createTaskStepSchema,
])

/**
 * Passthrough branch for plugin-registered node types. Validates against the
 * schema registered for `step.type`. If the type isn't registered, surfaces a
 * targeted error pointing at the likely cause (plugin didn't activate).
 */
const pluginStepSchema = z.unknown().superRefine((val, ctx) => {
  if (typeof val !== 'object' || val === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Step must be an object' })
    return
  }
  const record = val as Record<string, unknown>
  const kind = record.type
  if (typeof kind !== 'string') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Step is missing string `type` field',
      path: ['type'],
    })
    return
  }
  if (BUILTIN_KINDS.has(kind)) {
    // Builtins are handled by the discriminated union above; this branch should
    // never be reached for a builtin step. If we got here with a builtin kind
    // it means the builtin validation already failed — let that error surface.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid builtin step of kind '${kind}'`,
    })
    return
  }
  const def = registry.get(kind)
  if (!def) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown node type '${kind}' — did the plugin fail to activate?`,
      path: ['type'],
    })
    return
  }
  const result = def.zodSchema.safeParse(val)
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
        path: issue.path,
      })
    }
  }
})

export const stepSchema = z.union([builtinStepSchema, pluginStepSchema])

export const workflowInputSchema = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
}).passthrough()

/**
 * Canvas-editor layout hints. Optional — the workflow engine does not consult
 * this field at runtime. When present, `positions` maps step id → canvas
 * coordinates so the editor can restore node placement across saves instead of
 * auto-laying out from scratch every time.
 */
export const nodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
}).passthrough()

export const workflowLayoutSchema = z.object({
  positions: z.record(z.string(), nodePositionSchema).optional(),
}).passthrough()

export const workflowDefinitionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string(),
  version: z.number(),
  inputs: z.record(z.string(), workflowInputSchema).optional(),
  steps: z.array(stepSchema),
  layout: workflowLayoutSchema.optional(),
}).passthrough()

export type WorkflowDefinitionParsed = z.infer<typeof workflowDefinitionSchema>
