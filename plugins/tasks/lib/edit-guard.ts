/**
 * Task edit-safety guard (optimistic versioning + freeze-on-complete).
 *
 * Extracted from index.ts. Content mutations (update/assign/dependency/block)
 * pass through `taskEditGuard`, used by both the REST routes and the exec tools.
 * - A completed task (completions row in the execution ledger) refuses mutation
 *   until explicitly reopened (moved out of Done). Move/complete routes are
 *   exempt — they ARE the reopen/complete paths.
 * - A stale expectedVersion gets a 409 + edit_conflict audit so contention is
 *   measurable; omitting expectedVersion stays last-write-wins.
 *
 * Covered end-to-end by tests/plugins/tasks/task-edit-safety.test.ts via the
 * registry-registered routes, so this relocation is test-transparent.
 */
import { getTask } from '../../../src/core/task-store'
import { hasCompletion } from '../../../src/core/execution-ledger'

/**
 * Single identifier-fallback resolver for the mutation routes: path param
 * first, then body.id, then the legacy title fallbacks. Update passes
 * bodyTitleIsPayload because there body.title is the NEW title — never an
 * identifier — and identifies by body.originalTitle instead. Previously each
 * route inlined its own chain and update's had silently diverged.
 */
export function resolveTaskIdentifier(
  paramsTaskId: string | undefined,
  body: { id?: string; originalTitle?: string; title?: string },
  opts: { bodyTitleIsPayload?: boolean } = {},
): string | undefined {
  return paramsTaskId || body.id || body.originalTitle || (opts.bodyTitleIsPayload ? undefined : body.title)
}

export function taskEditGuard(
  ctx: { activity: { audit: (event: string, agent: string, data?: Record<string, unknown>) => void } },
  identifier: string,
  opts: { agent?: string; expectedVersion?: number } = {},
): { status: number; error: string; currentVersion?: number } | null {
  const task = getTask(identifier)
  if (!task) return null // unknown ids fall through to the handler's own error path
  if (hasCompletion(task.id)) {
    return { status: 409, error: `Task ${task.id} is completed — reopen it (move it out of Done) before editing.` }
  }
  const currentVersion = task.version ?? 0
  if (opts.expectedVersion !== undefined && currentVersion !== opts.expectedVersion) {
    ctx.activity.audit('edit_conflict', opts.agent ?? 'system', {
      taskId: task.id,
      expectedVersion: opts.expectedVersion,
      currentVersion,
    })
    return {
      status: 409,
      error: `Version conflict on ${task.id}: expected version ${opts.expectedVersion}, current is ${currentVersion}. Refetch and retry.`,
      currentVersion,
    }
  }
  return null
}

export function guardResponse(guard: { status: number; error: string; currentVersion?: number }): Response {
  return Response.json(
    { error: guard.error, ...(guard.currentVersion !== undefined ? { currentVersion: guard.currentVersion } : {}) },
    { status: guard.status },
  )
}
