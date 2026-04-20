/**
 * Workflow plugin types — definitions, runtime instances, and skills.
 */

import type { ApprovalActor } from '@bakin/core/plugin-types'

export type { ApprovalActor }

// ─── Definition Types ────────────────────────────────────────────────────────

export interface WorkflowInput {
  type: 'string' | 'number' | 'boolean'
  description: string
  required?: boolean
  default?: unknown
}

export interface StepOutput {
  id: string
  type?: 'string' | 'file' | 'number'
  path?: string
}

export interface NotifyChannel {
  channel: 'discord' | 'slack'
  target: string
}

export interface BaseStep {
  id: string
  label: string
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

export type WorkflowStep = AgentStep | GateStep | ParallelStep | OutputStep | NestedWorkflowStep

export interface WorkflowDefinition {
  id?: string
  name: string
  description: string
  version: number
  inputs?: Record<string, WorkflowInput>
  steps: WorkflowStep[]
}

// ─── Template Types ─────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  name: string
  filename: string
  description: string
  stepCount: number
  definition: WorkflowDefinition
  /** Provenance: 'plugin' for plugin-shipped definitions, 'user' for ones in ~/.bakin/workflows/definitions/ */
  source?: 'plugin' | 'user'
  /** Set when source === 'plugin' — the id of the plugin that shipped this workflow */
  pluginId?: string
}

// ─── Skill Types ────────────────────────────────────────────────────────────

export interface SkillDefinition {
  name: string
  output_schema?: Record<string, unknown>
  instructions: string
}

// ─── Instance Types ─────────────────────────────────────────────────────────

export type StepStatus =
  | 'pending'
  | 'in_progress'
  | 'complete'
  | 'pending_approval'
  | 'rejected'
  | 'failed'

export type InstanceStatus =
  | 'in_progress'
  | 'pending_approval'
  | 'complete'
  | 'failed'
  | 'cancelled'

export interface StepState {
  status: StepStatus
  startedAt?: string
  completedAt?: string
  output?: Record<string, unknown>
  previousOutput?: Record<string, unknown>
  rejectionReason?: string
  /** For nested workflow steps — the child instance's task ID (used as instance key) */
  childTaskId?: string
  /** Discord message ID for gate alert — used to edit the message after approval/rejection */
  discordMessageId?: string
  /** Gate decision metadata — set when a gate enters pending_approval and when a decision is recorded */
  requestedAt?: string
  decidedAt?: string
  approver?: ApprovalActor
}

export interface StepHistoryEntry {
  stepId: string
  status: StepStatus
  completedAt: string
  output?: Record<string, unknown>
  rejectionReason?: string
  /** For gate decisions — who approved/rejected this step */
  approver?: ApprovalActor
  /** For gate decisions — when the gate entered pending_approval */
  requestedAt?: string
}

export interface WorkflowInstance {
  instanceId: string
  workflowId: string
  taskId: string
  currentStepId: string
  status: InstanceStatus
  stepStates: Record<string, StepState>
  history: StepHistoryEntry[]
  createdAt: string
  updatedAt: string
  /** Snapshot of the task assignee at workflow start, used to resolve `$assigned` agent steps */
  resolvedAgent?: string
  /** If this instance was spawned by a parent workflow step */
  parentTaskId?: string
  parentStepId?: string
  /** Context injected from parent workflow — the prior step's output at the point the child was spawned */
  parentContext?: Record<string, unknown>
}
