/**
 * Workflow plugin types — definitions, runtime instances, and skills.
 */

import type { ApprovalActor } from '@bakin/core/plugin-types'
import type { ApprovalRenderRef } from '@bakin/core/adapters/runtime'
import type { WorkflowDefinition } from '@bakin/core/workflows/definition-types'
import type { WorkflowSkillDriftReport } from './lib/workflow-skill-drift'

export type { ApprovalActor }

// ─── Definition Types ────────────────────────────────────────────────────────

// The workflow-definition family is single-homed in core so the plugin
// registry, agent-package loader, and package-integrity checks can share it
// without importing this plugin's source tree. Re-exported type-only, so
// client bundles never pull the core module (type-only re-exports are erased
// at build) — pinned by tests/architecture/type-single-home.
export type {
  WorkflowInput,
  StepOutput,
  NotifyChannel,
  BaseStep,
  AgentStep,
  GateStep,
  ParallelStep,
  OutputStep,
  NestedWorkflowStep,
  MapWorkflowStep,
  CreateTaskStep,
  WorkflowStep,
  NodePosition,
  WorkflowLayout,
  WorkflowDefinition,
} from '@bakin/core/workflows/definition-types'

// ─── Template Types ─────────────────────────────────────────────────────────

export interface WorkflowShadowedSource {
  source: 'plugin' | 'agent-package'
  pluginId?: string
  packageId?: string
}

export interface WorkflowTemplate {
  name: string
  filename: string
  description: string
  stepCount: number
  definition: WorkflowDefinition
  /**
   * Provenance:
   *   - 'plugin' for plugin-shipped definitions
   *   - 'agent-package' for workflows shipped by an installed agent or
   *     workflow-pack package
   *   - 'user' for ones in ~/.bakin/workflows/definitions/
   */
  source?: 'plugin' | 'agent-package' | 'user'
  /** Set when source === 'plugin' — the id of the plugin that shipped this workflow */
  pluginId?: string
  /** Set when source === 'agent-package' — the id of the package that shipped this workflow */
  packageId?: string
  /** True when a managed workflow has been disabled by the user. */
  disabled?: boolean
  /** Set when a user workflow shadows a managed definition with the same id. */
  shadowedSource?: WorkflowShadowedSource
  /** Set when this workflow references one or more stale local workflow skills. */
  skillDrift?: WorkflowSkillDriftSummary
}

export interface WorkflowSkillDriftSummary {
  count: number
  repairableCount: number
  skills: string[]
  reports: WorkflowSkillDriftReport[]
  byStep: Record<string, string[]>
}

// ─── Skill Types ────────────────────────────────────────────────────────────

export interface SkillDefinition {
  name: string
  output_schema?: Record<string, unknown>
  instructions: string
  source?: string
  sourcePath?: string
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

/**
 * Typed step-failure codes. UIs and agents branch on these — never on error
 * message text (architecture-test enforced convention).
 */
export type StepErrorCode = 'map_source_invalid'

export type MapChildStatus = 'in_progress' | 'complete' | 'failed' | 'cancelled'

/** One fanned-out map_workflow child, in source-array order. */
export interface MapChildEntry {
  index: number
  childTaskId: string
  status: MapChildStatus
  /** The child's finalOutput, recorded at completion; aggregated on join. */
  output?: Record<string, unknown>
}

export interface StepState {
  status: StepStatus
  startedAt?: string
  completedAt?: string
  output?: Record<string, unknown>
  previousOutput?: Record<string, unknown>
  rejectionReason?: string
  /** For nested workflow steps — the child instance's task ID (used as instance key) */
  childTaskId?: string
  /** For map_workflow steps — one entry per fanned-out child, in source-array order */
  children?: MapChildEntry[]
  /** Typed failure code — set with status 'failed' where no CompleteStepResult carries it */
  code?: StepErrorCode
  /** Human-readable failure detail accompanying `code` */
  error?: string
  /** Runtime-rendered gate approval reference used to resolve the rendered approval after a decision */
  approvalRef?: ApprovalRenderRef
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
  /** Snapshot of runtime agents at workflow start, used to resolve preferred-agent selectors */
  availableAgents?: string[]
  /** Sticky per-step `team:<id>` resolutions (#611), keyed by stepId —
   * written once at first step dispatch; retries/revisions reuse the pick. */
  teamResolutions?: Record<string, { agentId: string; team: string; reason: string; at: string }>

  /** If this instance was spawned by a parent workflow step */
  parentTaskId?: string
  parentStepId?: string
  /** Context injected from parent workflow — the prior step's output at the point the child was spawned */
  parentContext?: Record<string, unknown>
}
