/**
 * Shared types for the first-run onboarding module.
 *
 * Every component module (mkdir, antfly, models, …) exports a `check()` that
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

/**
 * One row in the curated recommended-plugins list (Phase 6). Surfaced by
 * the `recommended-plugins` onboarding component during interactive
 * `bakin onboard`. The list itself is curated in
 * `src/core/onboarding/recommended-plugins.ts` and grows as Phase 4-5
 * extracts plugins from the bakin core into the bakin-bits-official
 * monorepo.
 */
export interface RecommendedPlugin {
  /** Plugin id — must match the manifest's id and Bakin's id regex. */
  readonly id: string
  /** Install source — typically `github:owner/repo#plugins/<id>` shape. */
  readonly source: string
  /** Display name for the prompt UI. */
  readonly name: string
  /** One-line description shown beneath the name in the prompt. */
  readonly description: string
  /**
   * Whether the plugin is selected by default in the prompt. The user
   * can deselect with space; defaults are surfaced for plugins that
   * the Bakin core team considers "the canonical first install."
   */
  readonly defaultSelected: boolean
}
