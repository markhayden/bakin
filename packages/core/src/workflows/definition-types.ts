/**
 * Workflow definition types — the declarative shape of a workflow (steps,
 * inputs, canvas layout hints) shared by core (plugin registry, agent-package
 * loading and integrity checks) and the workflows plugin.
 *
 * Only the definition family lives here. The runtime *instance* types
 * (WorkflowInstance, step state, history) and the template/skill types stay
 * in plugins/workflows/types.ts, which re-exports these type-only.
 * WorkflowDefinition is pinned to this home by
 * tests/architecture/type-single-home.test.ts.
 */

export interface WorkflowInput {
  type: 'string' | 'number' | 'boolean'
  description: string
  required?: boolean
  default?: unknown
  [k: string]: unknown
}

export interface StepOutput {
  id: string
  type?: 'string' | 'file' | 'number'
  path?: string
  [k: string]: unknown
}

export interface NotifyChannel {
  /** Channel id — resolves against the workflows.notificationChannels registry. */
  channel: string
  target: string
  [k: string]: unknown
}

export interface BaseStep {
  id: string
  label: string
  [k: string]: unknown
}

export interface AgentStep extends BaseStep {
  type: 'agent'
  agent: string
  task?: string
  skill?: string
  description?: string
  outputs?: StepOutput[]
  dependsOn?: string | string[]
  deny_tools?: string[]
}

export interface GateStep extends BaseStep {
  type: 'gate'
  description?: string
  approval_required?: boolean
  notify?: NotifyChannel[]
  preview?: string[]
  on_approve: string
  on_reject?: {
    goto: string
    note_to_agent?: boolean
    [k: string]: unknown
  }
  dependsOn?: string | string[]
}

export interface ParallelStep extends BaseStep {
  type: 'parallel'
  steps: (AgentStep | GateStep)[]
}

export interface OutputStep extends BaseStep {
  type: 'output'
  agent?: string
  skill?: string
  description?: string
  channels?: string[]
  content?: Record<string, string>
  schedule?: string
  dependsOn?: string | string[]
  deny_tools?: string[]
}

export interface NestedWorkflowStep extends BaseStep {
  type: 'workflow'
  workflow_id: string
  description?: string
  dependsOn?: string | string[]
}

export interface CreateTaskStep extends BaseStep {
  type: 'createTask'
  taskId?: string
  title: string
  description?: string
  agent?: string
  column?: string
  workflowId?: string
  parentId?: string
  projectId?: string
  availableAt?: string
  dueAt?: string
  source?: {
    pluginId?: string
    entityType?: string
    entityId?: string
    purpose?: string
    [k: string]: unknown
  }
  skipWorkflowReason?: string
  dependsOn?: string | string[]
}

export type WorkflowStep = AgentStep | GateStep | ParallelStep | OutputStep | NestedWorkflowStep | CreateTaskStep

export interface NodePosition {
  x: number
  y: number
  [k: string]: unknown
}

/**
 * Canvas-editor layout hints. Not consulted by the workflow runtime; persisted
 * only so node positions survive a save/load cycle in the visual editor.
 */
export interface WorkflowLayout {
  positions?: Record<string, NodePosition>
  [k: string]: unknown
}

export interface WorkflowDefinition {
  id?: string
  name: string
  description: string
  version: number
  inputs?: Record<string, WorkflowInput>
  steps: WorkflowStep[]
  layout?: WorkflowLayout
  [k: string]: unknown
}
