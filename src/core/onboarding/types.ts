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

export interface InstallResult {
  name: string
  status: InstallStatus
  message: string
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
