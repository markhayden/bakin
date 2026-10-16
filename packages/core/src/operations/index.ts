/**
 * Operations (#895) — the one progress primitive for every long-running flow.
 *
 * Leaf types are single-homed in the SDK (`@makinbakin/sdk/types`) and
 * re-exported here; the registry, resources and local runner live beside
 * this barrel. Deep reference: `.claude/knowledge/operations.md`.
 */

export {
  CORE_RESOURCES,
  OPERATION_QUIET_THRESHOLDS,
  OPERATION_STAGE_KINDS,
  operationQuietState,
  type CoreResource,
  type OperationAttempt,
  type OperationAttemptReason,
  type OperationBytes,
  type OperationCancelResponse,
  type OperationCancelResult,
  type OperationContext,
  type OperationGetResponse,
  type OperationItem,
  type OperationListResponse,
  type OperationLogEntry,
  type OperationLogLevel,
  type OperationNotFoundResponse,
  type OperationOrigin,
  type OperationOutcome,
  type OperationOutcomeSummary,
  type OperationOwner,
  type OperationPlan,
  type OperationQuietState,
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
export { OperationCancelledError, OperationRejectedError } from './errors'
export {
  createOperationRegistry,
  type OperationPublishKind,
  type OperationRegistry,
  type OperationRegistryDeps,
  type StartOperationInput,
} from './registry'
export {
  acquireResources,
  heldInContext,
  isResourceHeld,
  readResourceHolder,
  releaseResource,
  resourceLockPath,
  runHolding,
  sortResources,
  tryAcquireResources,
  type AcquireResourcesOptions,
  type ResourceHolder,
  type ResourceHolderIdentity,
  type ResourceLease,
  type ResourceWait,
} from './resources'
export { runLocal } from './local'
