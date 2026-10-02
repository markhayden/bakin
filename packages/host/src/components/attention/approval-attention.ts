/**
 * Pure attention rules for pending approvals — every decision is a pure
 * function the provider composes, unit-testable without DOM or fetch
 * (ported from the workflows plugin's gate rules, generalized per kind).
 *
 * A pending approval is actionable-by-human by definition; on a runtime
 * without a channel layer this in-app path is the ONLY delivery, so nothing
 * here is gated on runtime capabilities. The durable record stays the
 * authority — this is attention, not approval state.
 */

export interface ApprovalPendingPayload {
  approvalId: string
  kind: 'workflow-gate' | 'health-repair' | 'health-navigate' | string
  taskId: string
  title?: string
}

/** Every approval is decided on its task's detail — deep-link there (spec D7). */
export function approvalUrl(payload: Pick<ApprovalPendingPayload, 'taskId'>): string {
  return `/tasks?taskId=${encodeURIComponent(payload.taskId)}`
}

/** Already looking at that task: the approval panel is on screen, no fanfare. */
export function viewingApprovalTask(payload: Pick<ApprovalPendingPayload, 'taskId'>, location: { pathname: string; search: string }): boolean {
  if (!location.pathname.startsWith('/tasks')) return false
  return new URLSearchParams(location.search).get('taskId') === payload.taskId
}

export interface ApprovalAttention {
  notify: boolean
  title: string
  body: string
  url: string
}

const KIND_TITLES: Record<string, string> = {
  'workflow-gate': 'Approval needed',
  'health-repair': 'Repair needs your approval',
  'health-navigate': 'Health needs your attention',
}

export function attentionForApproval(
  payload: ApprovalPendingPayload,
  location: { pathname: string; search: string },
): ApprovalAttention {
  return {
    notify: !viewingApprovalTask(payload, location),
    title: KIND_TITLES[payload.kind] ?? 'Approval needed',
    body: payload.title ? `${payload.title} is waiting for your decision.` : 'A decision is waiting on the task board.',
    url: approvalUrl(payload),
  }
}
