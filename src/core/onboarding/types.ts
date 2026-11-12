/**
 * Shared types for the first-run onboarding module.
 *
 * Every component module (mkdir, search, search-models, ...) exports a `check()` that
 * returns CheckResult and an `install()` that returns InstallResult. The
 * orchestrator in index.ts calls them in a fixed dependency order and
 * aggregates the results into the .onboarded marker file.
 */

import type { CoreResource, OperationContext, OperationPlan } from '@bakin/core/operations'
import type { OnboardingInstallOptions } from './install-request'
import type { RuntimeAdapterName } from '../settings'

export type CheckStatus = 'ok' | 'missing' | 'broken' | 'warn' | 'error'
export type InstallStatus = 'installed' | 'skipped' | 'failed' | 'noop'

export interface CheckResult {
  name: string
  status: CheckStatus
  message: string
  /** Human-readable next step when status is missing/broken/warn/error. */
  remediation?: string
  /** Extra structured info for --json output. */
  details?: Record<string, unknown>
}

/**
 * Why a step was skipped. Consumers read this, never the message text.
 *  - `not_applicable`: the step does not exist on the active runtime
 *  - `declined`: the operator (or the absence of `--yes`) did not approve it
 *  - `requires`: a step it needs did not finish (`requires` names it)
 *  - `check_only`: `--check` found work and, by design, did not do it
 *  - `unavailable`: there is nothing the step can do right now and nobody
 *    refused it (`code` says what is missing); counts like a warning
 */
export type SkipReason = 'not_applicable' | 'declined' | 'requires' | 'check_only' | 'unavailable'

export interface InstallResult {
  name: string
  status: InstallStatus
  message: string
  /** Set when `status` is `skipped`; an install only ever declines or is unavailable. */
  reason?: Extract<SkipReason, 'declined' | 'unavailable'>
  /**
   * A typed detail: what is missing when `reason` is `unavailable`
   * (`no_runnable_model`), or the operation's outcome code when the install
   * `failed` for a reason a caller must tell apart.
   */
  code?: string
  error?: unknown
  durationMs: number
}

/**
 * What one component install gets: the explicit options of the shared request
 * (`install-request.ts`) — every prompt was resolved by the caller first.
 */
export type ComponentInstallOptions = OnboardingInstallOptions

/** `bakin onboard`'s run: which steps, and what the operator already approved. */
export interface OnboardingOptions {
  /** --yes flag: approve every component's default selection. */
  autoApprove: boolean
  /** --json flag. Emit one structured line per component to stdout. */
  json: boolean
  /** --check flag. Run check() only, never install(). */
  checkOnly: boolean
  /** --force flag. Delete the existing marker before running. */
  force: boolean
  /** Explicit official plugin ids selected by the TUI. Undefined means use defaults. */
  selectedRecommendedPluginIds?: readonly string[]
  /** Explicit official agent ids selected by the TUI. Undefined means use defaults. */
  selectedRecommendedAgentIds?: readonly string[]
  /** Component ids explicitly approved by the human onboarding TUI. */
  approvedComponents?: readonly string[]
  /**
   * Components the operator declined outright (`--no-recommended`). A
   * declined component is neither checked nor installed — not even when
   * `autoApprove` would otherwise select its defaults — and its outcome is
   * `skipped` / `declined`.
   */
  declinedComponents?: readonly string[]
  /**
   * The runtime a first run decided on (`decideRuntime`, `persist: true`).
   * The `settings` install commits it under `install-state` — and is run
   * for it even when the settings check is already ok, because only that
   * operation can tell whether another run stored a different one meanwhile.
   */
  runtimeProposal?: string
  /** Optional human UI completion callback. Never used for JSON output. */
  onOutcome?: (outcome: {
    name: string
    finalStatus: 'ok' | 'warn' | 'skipped' | 'error'
    message: string
    remediation?: string
  }) => void
}

interface ComponentBase {
  /** Stable identifier. Matches the key under components[] in the marker file. */
  readonly name: string
  /**
   * Runtime adapters this component applies to. Omit for adapter-generic
   * components. The orchestrator skips (never checks/installs) components
   * whose list excludes settings.runtime.adapter — e.g. the OpenClaw
   * integration component is meaningless on the in-process Pi runtime.
   */
  readonly supportedAdapters?: readonly RuntimeAdapterName[]
  /**
   * The components this one cannot run without, by name. Each must come
   * earlier in COMPONENT_ORDER. A requirement is satisfied when that
   * component finished `ok` or `warn`, or does not apply to the active
   * runtime; otherwise this component is skipped with reason `requires`
   * and never checked or installed.
   */
  readonly requires: readonly string[]
  /**
   * The subset of `requires` that must have finished `ok`: a `warn` there
   * does NOT satisfy this component. For a requirement whose warning means
   * "this home does not run it" rather than "it works with a caveat" — the
   * search engine's models need an engine this home actually manages.
   */
  readonly requiresOk?: readonly string[]
  /**
   * Under `--check` nothing is installed, so a component that only reports
   * `missing` would block everything after it. Set this when the built-in
   * defaults make its dependents checkable before it exists (the home
   * directory tree, the settings file): a `missing` check then satisfies
   * dependents. A `broken` or failed one never does.
   */
  readonly usableWhenMissing?: boolean
  check(): Promise<CheckResult>
}

/** A component Bakin can set up: its install runs as an operation (#895). */
export interface InstallableComponent extends ComponentBase {
  /** The install's stages and point of no return, declared before it starts. */
  readonly plan: OperationPlan
  /** The resources the install owns for its whole run, in the canonical order. */
  readonly resources: readonly CoreResource[]
  /**
   * Inputs beyond the request that define what the install does (search:
   * the active search settings). Part of the operation's identity, and
   * rechecked after a wait — an install never runs under an identity that
   * no longer describes it.
   */
  identity?(): unknown
  /** The outcome code when the install reports `failed` (default `component_failed`). */
  readonly failureCode?: string
  /** Runs inside the component's operation, which owns `resources`; reports only through `op`. */
  install(opts: ComponentInstallOptions, op: OperationContext): Promise<InstallResult>
}

/** A prerequisite the operator sets up outside Bakin (runtime, credentials): checked, never installed. */
export interface CheckOnlyComponent extends ComponentBase {
  /** Where the operator sets it up — the outcome message when the check is not ok. */
  readonly manualSetup: string
  readonly install?: never
}

export type OnboardingComponent = InstallableComponent | CheckOnlyComponent

export function isInstallable(component: OnboardingComponent): component is InstallableComponent {
  return typeof component.install === 'function'
}
