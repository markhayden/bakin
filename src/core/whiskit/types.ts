/**
 * Shared types for the Whiskit build backend (Phase 2).
 *
 * The backend has one job: turn a plugin source dir into `dist/{index.js,
 * client.js}` the same way everywhere — `bakin plugins publish --build` on a
 * producer machine, install-time builds on a consumer machine, and the
 * source-run dev loop. Build failures carry a `stage` so callers can show
 * "dependency install failed" instead of a generic stack.
 */

/** Result of one system-`bun` subprocess run. */
export interface WhiskitCommandResult {
  exitCode: number
  /** Captured stdout, capped at OUTPUT_CAP_BYTES. */
  stdout: string
  /** Captured stderr, capped at OUTPUT_CAP_BYTES. */
  stderr: string
  /** True when the process was killed by the timeout. */
  timedOut: boolean
  durationMs: number
}

/** Where in the build pipeline a failure happened. */
export type WhiskitBuildStage =
  | 'resolve-bun'
  | 'validate'
  | 'resolve-sdk'
  | 'install'
  | 'server-build'
  | 'client-build'
  | 'css-validate'

export class WhiskitBuildError extends Error {
  readonly stage: WhiskitBuildStage
  /** Trimmed stderr tail from the failing subprocess, when there was one. */
  readonly stderr?: string

  constructor(stage: WhiskitBuildStage, message: string, stderr?: string) {
    super(message)
    this.name = 'WhiskitBuildError'
    this.stage = stage
    this.stderr = stderr
  }
}

/** Stage progress event for observability (startup spans, dev overlay). */
export interface WhiskitStageEvent {
  stage: 'install' | 'server-build' | 'client-build' | 'css-validate'
  status: 'ok' | 'error'
  durationMs: number
}

/** A request to build one plugin source dir into dist/. */
export interface WhiskitBuildRequest {
  pluginDir: string
  /** Defaults to basename(pluginDir). Used in diagnostics and the browser CSS ownership root. */
  pluginId?: string
  /** Minify the client bundle (publish/release builds). */
  production?: boolean
  /**
   * Run `bun install --ignore-scripts` first when the plugin declares
   * dependencies. Publish/install paths want this; the dev hot loop
   * usually has node_modules already.
   */
  installDeps?: boolean
  /** Per-subprocess timeout. Defaults to DEFAULT_BUILD_TIMEOUT_MS. */
  timeoutMs?: number
  /**
   * Set false to skip the server compile (and its SDK resolution) — used
   * when a trusted prebuilt server dist only needs its client refreshed.
   */
  serverBuild?: boolean
  /** Optional per-stage observer — callers map these to diagnostics spans. */
  onStage?: (event: WhiskitStageEvent) => void
}

export interface WhiskitBuildResult {
  pluginId: string
  builtServer: boolean
  /** False when the plugin has no client.tsx. */
  builtClient: boolean
  /** True when `bun install --ignore-scripts` ran. */
  installedDeps: boolean
  /** Which backend compiled the bundles. */
  backend: 'system-bun' | 'in-process'
  durationMs: number
}
