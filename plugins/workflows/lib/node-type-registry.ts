/**
 * Node-type registry — single source of truth for the workflow step type system.
 *
 * Every step in a workflow definition belongs to a node type. Each node type
 * exposes a Zod schema that validates its shape AND form-field metadata that
 * drives the UI editor. The two share one definition so the form editor and
 * the YAML loader cannot drift.
 *
 * MVP ships 5 builtins (agent, gate, parallel, output, workflow). The
 * `registerNodeType` API is the forward-compat hook for plugin-registered
 * node types — see Phase 2A in `.claude/specs/workflows-plugin-architecture.md`.
 */
import { z } from 'zod'

// ─── Public types ───────────────────────────────────────────────────────────

export type NodeRuntime = 'builtin'

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

export interface NodeTypeDef<T = unknown> {
  kind: string
  runtime: NodeRuntime
  zodSchema: z.ZodType<T>
  formFields: FormField[]
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

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

const dependsOnSchema = z.union([z.string(), z.array(z.string())]).optional()

const stepOutputSchema = z.object({
  id: z.string(),
  type: z.enum(['string', 'file', 'number']).optional(),
  path: z.string().optional(),
})

const notifyChannelSchema = z.object({
  channel: z.enum(['discord', 'slack']),
  target: z.string(),
})

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
  dependsOn: dependsOnSchema,
  deny_tools: z.array(z.string()).optional(),
})

export const gateStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('gate'),
  label: z.string().min(1),
  description: z.string().optional(),
  approval_required: z.boolean().optional(),
  notify: z.array(notifyChannelSchema).optional(),
  preview: z.array(z.string()).optional(),
  on_approve: z.string().min(1),
  on_reject: z
    .object({
      goto: z.string(),
      note_to_agent: z.boolean().optional(),
    })
    .optional(),
  dependsOn: dependsOnSchema,
})

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
  dependsOn: dependsOnSchema,
  deny_tools: z.array(z.string()).optional(),
})

export const nestedWorkflowStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('workflow'),
  label: z.string().min(1),
  workflow_id: z.string().min(1),
  description: z.string().optional(),
  dependsOn: dependsOnSchema,
})

// Parallel children are a closed subset (agent | gate). Defined separately so
// the parallel schema can reference them without recursion through the union.
const parallelChildSchema = z.discriminatedUnion('type', [agentStepSchema, gateStepSchema])

export const parallelStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('parallel'),
  label: z.string().min(1),
  steps: z.array(parallelChildSchema).min(1),
})

// ─── Builtin form-field metadata (drives the editor UI) ─────────────────────

const agentFormFields: FormField[] = [
  { name: 'agent', type: 'agent', required: true, description: 'Agent that runs this step' },
  { name: 'skill', type: 'skill', description: 'Optional skill instructions to inject' },
  { name: 'task', type: 'text', description: 'One-line task description' },
  { name: 'description', type: 'text', description: 'Long-form description' },
  { name: 'dependsOn', type: 'list', description: 'Step IDs that must complete first' },
  { name: 'deny_tools', type: 'list', description: 'Tool names this step may not call' },
]

const gateFormFields: FormField[] = [
  { name: 'description', type: 'text' },
  { name: 'approval_required', type: 'boolean' },
  { name: 'on_approve', type: 'string', required: true, description: 'Step id to advance to' },
  { name: 'on_reject', type: 'string', description: 'Step id to fall back to on rejection' },
  { name: 'preview', type: 'list', description: 'Output keys to show in the gate preview' },
]

const parallelFormFields: FormField[] = [
  { name: 'steps', type: 'list', required: true, description: 'Child steps run in parallel' },
]

const outputFormFields: FormField[] = [
  { name: 'agent', type: 'agent' },
  { name: 'skill', type: 'skill' },
  { name: 'channels', type: 'list', description: 'Output channels (e.g. discord, slack)' },
  { name: 'content', type: 'text', description: 'Content map (key → value)' },
  { name: 'schedule', type: 'string', description: 'Cron expression for recurring outputs' },
]

const nestedWorkflowFormFields: FormField[] = [
  { name: 'workflow_id', type: 'string', required: true, description: 'Id of the workflow to invoke' },
  { name: 'description', type: 'text' },
]

// ─── Self-registration of builtins ──────────────────────────────────────────

registerNodeType({
  kind: 'agent',
  runtime: 'builtin',
  zodSchema: agentStepSchema,
  formFields: agentFormFields,
})
registerNodeType({
  kind: 'gate',
  runtime: 'builtin',
  zodSchema: gateStepSchema,
  formFields: gateFormFields,
})
registerNodeType({
  kind: 'parallel',
  runtime: 'builtin',
  zodSchema: parallelStepSchema,
  formFields: parallelFormFields,
})
registerNodeType({
  kind: 'output',
  runtime: 'builtin',
  zodSchema: outputStepSchema,
  formFields: outputFormFields,
})
registerNodeType({
  kind: 'workflow',
  runtime: 'builtin',
  zodSchema: nestedWorkflowStepSchema,
  formFields: nestedWorkflowFormFields,
})

// ─── Top-level workflow schema (discriminated union over registered kinds) ──

export const stepSchema = z.discriminatedUnion('type', [
  agentStepSchema,
  gateStepSchema,
  parallelStepSchema,
  outputStepSchema,
  nestedWorkflowStepSchema,
])

export const workflowInputSchema = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
})

export const workflowDefinitionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string(),
  version: z.number(),
  inputs: z.record(z.string(), workflowInputSchema).optional(),
  steps: z.array(stepSchema).min(1),
})

export type WorkflowDefinitionParsed = z.infer<typeof workflowDefinitionSchema>
