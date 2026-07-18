/**
 * Workflow Runtime Engine — public barrel
 *
 * Enforces step-by-step agent execution through information gating.
 * Agents only ever see their current step and cannot advance until
 * Bakin validates their output and releases the next step.
 *
 * Key design decisions:
 * - Agents never see future steps (information gating)
 * - Step output is validated against JSON Schema before advancement
 * - Parallel steps dispatch to multiple agents; the join is implicit
 *   (next step only activates when ALL parallel children complete)
 * - Gate steps block until a human approves or rejects
 * - Rejection rewinds to a target step with context
 *
 * This module is a re-export barrel over the seam modules (instance-store,
 * task-bridge, step-context, node-dispatch, engine, gates). It is the
 * canonical import path — `index.ts`, sibling lib modules, and 6+ test files
 * mock.module THIS path, so it must remain the public surface. Sibling
 * modules import each other directly (never this barrel) to avoid cycles.
 */

// ─── Instance persistence + gate-notification tracking ──────────────────────
export {
  loadInstance,
  saveInstance,
  deleteInstance,
  listInstances,
  isGateNotified,
  markGateNotified,
  clearGateNotified,
  recordStepTeamResolution,
} from './instance-store'

// ─── Board-task bridge ──────────────────────────────────────────────────────
export {
  reconcilePendingApprovalTaskColumns,
  type PendingApprovalTaskColumnReconcileResult,
} from './task-bridge'

// ─── Read-only step context (information gating) ────────────────────────────
export {
  getCurrentStep,
  authorizeWorkflowToolUse,
  getActiveAgents,
  type StepContext,
  type WorkflowToolUseAction,
  type WorkflowToolUseAuthorization,
} from './step-context'

// ─── Node dispatch ──────────────────────────────────────────────────────────
export {
  type PluginNodeDispatchPayload,
} from './node-dispatch'

// ─── Engine (mutation core) ─────────────────────────────────────────────────
export {
  createInstance,
  completeStep,
  cancelInstance,
  type CompleteStepResult,
} from './engine'

// ─── Map-child recovery (per-child retry/cancel/list) ───────────────────────
export {
  retryMapChild,
  cancelMapChild,
  listMapChildren,
  type MapChildOpResult,
  type MapChildInfo,
} from './map-children'

// ─── Gate operations (human approval) ───────────────────────────────────────
export {
  approveGate,
  rejectGate,
  reopenFromStep,
  type ApproveGateOptions,
  type RejectGateOptions,
  type ReopenFromStepOptions,
  type ReopenFromStepResult,
  type GateDecisionRecord,
} from './gates'
