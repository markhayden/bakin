/**
 * Task dispatch system for Bakin — public barrel.
 *
 * The implementation is split across sibling modules (dispatch-types,
 * dispatch-failures, dispatch-state, dispatch-board, dispatch-context-blocks,
 * dispatch-prompts, dispatch-turns, dispatch-session-death, dispatch-workflow,
 * dispatch-cycle, dispatch-single). This file re-exports the public surface so
 * `@/core/dispatch` consumers (server.ts namespace import; the test files that
 * mock.module the path) keep their import path unchanged. Internal modules
 * import each other directly — never through this barrel — to avoid self-cycles.
 */
import { dispatchSingleTask } from './dispatch-single'

// ── Public surface (unchanged for every `@/core/dispatch` consumer) ──
export { classifyDispatchError, classifyDispatchFailureDetail, formatSanitizedRuntimeFailure } from './dispatch-failures'
export { loadDispatchState, clearDispatchMarker } from './dispatch-state'
export { isTaskDispatchEligible } from './dispatch-board'
export { __resetLessonBlockCache, buildDispatchLessonBlock, buildDispatchAssetBlock } from './dispatch-context-blocks'
export { buildDispatchMessage } from './dispatch-prompts'
export { budgetGate, deferForBudget, dispatchPaused, getInFlightTurnCount, awaitDispatchIdle } from './dispatch-turns'
export { dispatchTasks, start, stop, getDispatchInfo, requestImmediateDispatch } from './dispatch-cycle'
export { dispatchSingleTask }

export type {
  DispatchEligibility,
  DispatchIneligibleReason,
  DispatchContinuationContext,
  DispatchRosterAgent,
} from './dispatch-types'
