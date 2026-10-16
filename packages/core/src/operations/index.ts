/**
 * Operations (#895) — the one progress primitive for every long-running flow.
 *
 * Leaf types are single-homed in the SDK (`@makinbakin/sdk/types`) and
 * re-exported here; the registry, resources and local runner live beside
 * this barrel. Deep reference: `.claude/knowledge/operations.md`.
 */

export {
  CORE_RESOURCES,
  OPERATION_STAGE_KINDS,
  type CoreResource,
  type OperationAttempt,
  type OperationAttemptReason,
  type OperationBytes,
  type OperationCancelResult,
  type OperationContext,
  type OperationItem,
  type OperationListResponse,
  type OperationLogEntry,
  type OperationLogLevel,
  type OperationOrigin,
  type OperationOutcome,
  type OperationOutcomeSummary,
  type OperationOwner,
  type OperationPlan,
  type OperationQuietThresholds,
  type OperationStageKind,
  type OperationStagePlan,
  type OperationStageStatus,
  type OperationStageView,
  type OperationStartResponse,
  type OperationStatus,
  type OperationView,
  type OperationWaitingFor,
} from '@makinbakin/sdk/types'
export { OperationCancelledError } from './errors'
