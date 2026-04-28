/**
 * Shared types for the first-run onboarding module.
 *
 * Every component module (mkdir, search, search-models, ...) exports a `check()` that
 * returns CheckResult and an `install()` that returns InstallResult. The
 * orchestrator in index.ts calls them in a fixed dependency order and
 * aggregates the results into the .onboarded marker file.
 */

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

export interface OnboardingOptions {
  /** TTY prompts are allowed. False implies --yes or --json. */
  interactive: boolean
  /** --yes flag. Skip confirmation prompts, auto-approve installs. */
  autoApprove: boolean
  /** --json flag. Emit one structured line per component to stdout. */
  json: boolean
  /** --check flag. Run check() only, never install(). */
  checkOnly: boolean
  /** --force flag. Delete the existing marker before running. */
  force: boolean
}

export interface OnboardingComponent {
  /** Stable identifier. Matches the key under components[] in the marker file. */
  readonly name: string
  check(): Promise<CheckResult>
  install(opts: OnboardingOptions): Promise<InstallResult>
}
