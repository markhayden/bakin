/**
 * Pure attention rules for pending gate approvals — mirrors the chat
 * plugin's attention.ts split: every decision is a pure function the badge
 * provider composes, unit-testable without DOM or fetch.
 *
 * A pending gate is actionable-by-human by definition; on Pi (no channel
 * layer) this in-app path is the ONLY delivery, so nothing here is gated on
 * runtime capabilities. The durable approval record stays the authority —
 * this is attention, not approval state.
 */
import type { NavBadge } from '@makinbakin/sdk'

export interface GateReachedPayload {
  instanceId: string
  taskId: string
  workflowId: string
  stepId: string
  label?: string
}

/** Nav badge for N pending gates: attention-toned count, hidden at zero. */
export function gateBadge(pendingCount: number): NavBadge | null {
  if (pendingCount <= 0) return null
  return { count: pendingCount, tone: 'attention' }
}

/** The gate is approved/rejected on the task detail — deep-link there. */
export function gateUrl(gate: Pick<GateReachedPayload, 'taskId'>): string {
  return `/tasks?taskId=${encodeURIComponent(gate.taskId)}`
}

/**
 * Whether the user is already looking at the task whose gate fired —
 * suppress toast/notification, the gate panel is on their screen.
 */
export function viewingGateTask(gate: Pick<GateReachedPayload, 'taskId'>, location: { pathname: string; search: string }): boolean {
  if (!location.pathname.startsWith('/tasks')) return false
  return new URLSearchParams(location.search).get('taskId') === gate.taskId
}

export interface GateAttention {
  notify: boolean
  title: string
  body: string
  url: string
}

/** Toast/OS-notification decision + copy for a freshly pending gate. */
export function attentionForGate(
  gate: GateReachedPayload,
  location: { pathname: string; search: string },
): GateAttention {
  return {
    notify: !viewingGateTask(gate, location),
    title: 'Approval needed',
    body: gate.label ? `${gate.label} is waiting for your decision.` : 'A workflow gate is waiting for your decision.',
    url: gateUrl(gate),
  }
}
