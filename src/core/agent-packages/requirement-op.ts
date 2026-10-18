/**
 * Where an install helper reports inside an operation (#895): the caller's
 * `op` and the id of the stage its plan declared for this leg. The CALLER
 * enters the stage — so its plan, not the helper, decides whether that stage
 * is the point of no return; helpers only add items, bytes and retries.
 */
import type { OperationContext } from '@makinbakin/sdk/types'

export interface RequirementOp {
  op: OperationContext
  stageId: string
}
