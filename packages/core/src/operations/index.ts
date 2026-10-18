/**
 * Operations (#895) — the one progress primitive for every long-running flow.
 *
 * Leaf types are single-homed in the SDK (`@makinbakin/sdk/types`) and
 * re-exported here; the registry, resources and local runner live beside
 * this barrel. Deep reference: `.claude/knowledge/operations.md`.
 */

export {
  CORE_RESOURCES,
  isOperationFinished,
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
  type PluginOperationStartInput,
  type PluginOperationsAPI,
} from '@makinbakin/sdk/types'
export { OperationCancelledError, OperationRejectedError, ResourceBusyError } from './errors'
export {
  CHILD_PARTIAL_CODE,
  CHILD_SKIPPED_CODE,
  parentOutcome,
  tallyChildren,
  type ChildTally,
  type ParentOutcome,
  type ParentOutcomeCode,
} from './children'
export {
  createOperationRegistry,
  type ChildOperationInput,
  type OperationPublishKind,
  type OperationRegistry,
  type OperationRegistryDeps,
  type StartOperationInput,
} from './registry'
export {
  acquireResources,
  assertResourceHeld,
  heldInContext,
  holdNow,
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
export { responseOutcome } from './outcome'
export { operationStartResponseSchema } from './schema'
export { createMemoryResourceAcquirer } from './memory-resources'
export { operationOriginFromRequest } from './origin'
export { assertPluginResources, OperationResourceDeniedError, toPluginOperationInput } from './plugin'
