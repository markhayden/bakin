/**
 * Approval kind registry — the ONE primitive's extension point (spec D6/D7).
 *
 * A kind handler owns what a decision MEANS: the workflows plugin registers
 * `workflow-gate` (approve/reject a gate), the doctor registers
 * `health-repair` and `health-navigate`, and core itself owns `plugin-gate`
 * (one handler fanning out to plugin gates — `plugin-gates.ts`). Core owns the record, the resolve
 * orchestration, rehydration and channel wiring; it never imports a kind.
 */
import type { ApprovalDelivery, ApprovalProvenance } from '@bakin/core/adapters/runtime'
import type { RuntimeChannelSurface } from '@bakin/core/adapters/runtime/channels'
import type { ApprovalKind, ApprovalOwner, ApprovalRecord } from '@bakin/core/approvals'

/** A decision as the service receives it, before it becomes the record's response. */
export interface ApprovalDecision {
  option: string
  comment?: string
  /** Built by the transport that carried the decision (#898 D-H1). */
  provenance: ApprovalProvenance
  respondedAt?: string
}

/**
 * What rehydration learns about the thing an approval is about:
 *   live     — still waiting on this decision; keep (and re-render) it
 *   orphaned — the owner moved on without it; cancel the record
 *   unknown  — cannot tell right now (e.g. a transiently unreadable file);
 *              skip, NEVER cancel — a false-positive cancel kills live buttons
 */
export type ApprovalOwnerState = 'live' | 'orphaned' | 'unknown'

export type OwnerOf<K extends ApprovalKind> = Extract<ApprovalOwner, { kind: K }>
export type RecordOf<K extends ApprovalKind> = ApprovalRecord & { owner: OwnerOf<K> }

export interface ApprovalKindHandler<K extends ApprovalKind = ApprovalKind> {
  kind: K
  ownerState(record: RecordOf<K>): Promise<ApprovalOwnerState>
  /**
   * Apply the decision. Throw a typed ApprovalResolveError to refuse it — the
   * record then stays pending and the caller gets the error's HTTP status.
   * A returned value rides back to callers of `resolveApprovalWithResult`
   * (e.g. a repair's apply report) and is never persisted on the record.
   */
  onResolve(record: RecordOf<K>, decision: ApprovalDecision): Promise<unknown>
  /**
   * Runs strictly AFTER the decision is saved, the channel card is updated and
   * the resolution is published (#895 D24) — e.g. waiting for the repair the
   * decision started, recording its outcome and following up on the channel.
   * Fire-and-forget: it never delays the resolver, and a throw is logged.
   * Receives whatever `onResolve` returned.
   */
  afterResolve?(record: RecordOf<K>, result: unknown): Promise<void>
  /**
   * Render the approval on a runtime channel. Default: one `createApproval`
   * card. Kinds with richer context (gates post output + a thread) override.
   */
  render?(record: RecordOf<K>, channels: RuntimeChannelSurface, resolvedChannel: string): Promise<ApprovalDelivery[]>
}

const handlers = new Map<ApprovalKind, ApprovalKindHandler>()

export function registerApprovalKind<K extends ApprovalKind>(handler: ApprovalKindHandler<K>): void {
  handlers.set(handler.kind, handler as unknown as ApprovalKindHandler)
}

export function getApprovalKind(kind: ApprovalKind): ApprovalKindHandler | undefined {
  return handlers.get(kind)
}

/** Test-only: forget every registered kind. */
export function clearApprovalKinds(): void {
  handlers.clear()
}
