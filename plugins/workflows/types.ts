/**
 * Workflow plugin types — template/recipe library (no execution)
 */

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
  task: string
  outputs?: StepOutput[]
}

export interface GateStep extends BaseStep {
  type: 'gate'
  description?: string
  notify?: NotifyChannel[]
  preview?: string[]
  on_approve: string
  on_reject?: {
    goto: string
    note_to_agent?: boolean
  }
}

export interface ParallelStep extends BaseStep {
  type: 'parallel'
  steps: (AgentStep | GateStep)[]
}

export interface OutputStep extends BaseStep {
  type: 'output'
  channels?: string[]
  content?: Record<string, string>
  schedule?: string
}

export type WorkflowStep = AgentStep | GateStep | ParallelStep | OutputStep

export interface WorkflowDefinition {
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
}
