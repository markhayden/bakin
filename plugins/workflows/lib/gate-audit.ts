/**
 * Gate audit helpers
 *
 * Shared by the gate routes and the channel-approval handlers: resolve a
 * gate's description from its definition, and shape the structured audit
 * payload for gate.approved / gate.rejected. The decision record is the
 * source of truth — approver, gateLabel, timestamps, durationMs flow through it.
 */
import type { GateDecisionRecord } from './runtime'
import { loadDefinition } from './parser'

// Returns undefined if the workflow or step can't be loaded; the summary will
// simply omit the description.
export function getGateDescription(workflowId: string, stepId: string): string | undefined {
  const def = loadDefinition(workflowId)
  if (!def) return undefined
  const step = def.steps.find(s => s.id === stepId)
  return (step as { description?: string } | undefined)?.description
}

export function buildGateAuditPayload(
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
