/**
 * Onboarding orchestrator — public API for `bakin onboard` and doctor.
 *
 * runOnboard() walks every component in a fixed dependency order:
 *
 *   mkdir -> settings -> runtime -> search -> search-models -> openclaw-integration -> plugin-assets -> agent-assets -> llm -> channels -> recommended-plugins -> recommended-agents
 *
 * For each component:
 *   1. Call `check()`. If it reports `ok` or `warn`, record and move on.
 *   2. If it reports `missing` or `broken`:
 *        - In --check mode: record as `skipped`, never call install()
 *        - Otherwise: call `install(opts)` — the component itself prompts
 *          interactively (via askYesNo in prompts.ts) and respects the
 *          non-interactive-requires-yes rule. The orchestrator never
 *          double-prompts.
 *   3. Translate the install status into the final component status:
 *        installed | noop → 'ok'
 *        skipped           → 'skipped'
 *        failed            → 'error'
 *
 * Special cases baked into the flow:
 *   - Runtime missing/broken is a hard stop: the orchestrator records
 *     the runtime status, marks every downstream component as 'skipped'
 *     with a "runtime required" message, and returns without writing
 *     the marker. Exit code 1.
 *   - Search adapter missing that cascades into search-models: if search's
 *     post-install status is not 'ok', search-models is force-skipped with
 *     the reason "search adapter binary required." No point shelling to a binary that
 *     doesn't exist.
 *
 * Marker-write rule (matches the spec and Mark's sign-off):
 *   - exitCode 0 (all ok) → write marker
 *   - exitCode 2 (any warn/skipped, no errors) → write marker
 *   - exitCode 1 (any error/failed) → do NOT write marker. The user
 *     must fix the broken component and rerun.
 *
 * checkAll() is the read-only equivalent: it calls every component's
 * `check()` and returns the results, never running install. Used by
 * `bakin check all` and by the doctor gate in T13 when it wants to
 * surface which pieces are wired up (not just whether the marker
 * exists).
 */
import { createLogger } from '../logger'
import { mkdirComponent } from './mkdir'
import { settingsComponent } from './settings'
import { runtimeComponent } from './runtime'
import { searchComponent } from './search'
import { searchModelsComponent } from './search-models'
import { openClawIntegrationComponent } from './openclaw-integration'
import { pluginAssetsComponent } from './plugin-assets'
import { agentSyncComponent } from './agent-sync'
import { llmComponent, channelsComponent } from './credentials'
import { budgetComponent } from './budget'
import { recommendedPluginsComponent } from './recommended-plugins'
import { recommendedAgentsComponent } from './recommended-agents'
import { saveState, clearMarker } from './state'
import type { CheckResult, OnboardingComponent, OnboardingOptions } from './types'
import type { ComponentStatus } from './state'

const log = createLogger('onboarding:orchestrator')

/**
 * Adapter applicability gate: a component that declares supportedAdapters
 * runs only when the ACTIVE runtime adapter is in its list.
 */
function componentApplies(component: OnboardingComponent): boolean {
  if (!component.supportedAdapters) return true
  try {
    const { getSettings } = require('../settings') as typeof import('../settings')
    return component.supportedAdapters.includes(getSettings().runtime.adapter)
  } catch {
    return true
  }
}

export { isOnboarded, loadState, saveState, clearMarker, ONBOARDING_VERSION } from './state'
export type { CheckResult, InstallResult, OnboardingOptions, OnboardingComponent, CheckStatus, InstallStatus } from './types'
export type { OnboardingState, ComponentStatus } from './state'

/**
 * Fixed component order. This is the single source of truth for which
 * components run and in what sequence. Adding a new component is one
 * entry in this array plus one bump to ONBOARDING_VERSION in state.ts.
 */
export const COMPONENT_ORDER: readonly OnboardingComponent[] = [
  mkdirComponent,
  settingsComponent,
  runtimeComponent,
  searchComponent,
  searchModelsComponent,
  openClawIntegrationComponent,
  pluginAssetsComponent,
  agentSyncComponent,
  llmComponent,
  budgetComponent,
  channelsComponent,
  recommendedPluginsComponent,
  recommendedAgentsComponent,
] as const

/**
 * Result of a single component's full check+install cycle, as seen by
 * the orchestrator. Status is already normalized to ComponentStatus
 * (the marker-file shape) for easy aggregation.
 */
export interface ComponentOutcome {
  name: string
  finalStatus: ComponentStatus
  /** Result of the initial check() call. Always populated. */
  check: CheckResult
  /** The final message to print/return to the user. */
  message: string
  /** Remediation text, populated when finalStatus is 'warn' or 'error'. */
  remediation?: string
  /** Extra details for --json output. */
  details?: Record<string, unknown>
  /** Milliseconds the component took (check + optional install). */
  durationMs: number
}

export interface RunOnboardResult {
  outcomes: ComponentOutcome[]
  exitCode: 0 | 1 | 2
  markerWritten: boolean
}

const DEFAULT_BAKIN_VERSION = '0.0.0'

function resolveBakinVersion(): string {
  // Best-effort: the real version comes from package.json at build time.
  // We read it here via require so the value stays in sync with whatever
  // is in the repo when the orchestrator runs. Failure is non-fatal —
  // the marker's bakinVersion is informational only.
  try {
    const pkg = require('../../../package.json') as { version?: string }
    return pkg.version ?? DEFAULT_BAKIN_VERSION
  } catch {
    return DEFAULT_BAKIN_VERSION
  }
}

function emitJson(outcome: ComponentOutcome): void {
  const line = {
    component: outcome.name,
    status: outcome.finalStatus,
    message: outcome.message,
    ...(outcome.remediation ? { remediation: outcome.remediation } : {}),
    ...(outcome.details ? { details: outcome.details } : {}),
    durationMs: outcome.durationMs,
  }
  // One JSON object per line, flushed immediately so CI logs stream.
  process.stdout.write(JSON.stringify(line) + '\n')
}

function emitOutcome(opts: OnboardingOptions, outcome: ComponentOutcome): void {
  opts.onOutcome?.({
    name: outcome.name,
    finalStatus: outcome.finalStatus,
    message: outcome.message,
    remediation: outcome.remediation,
  })
}

/**
 * Run one component through the full check → (optional install) → outcome
 * pipeline. Never throws — all errors are converted into an outcome with
 * `finalStatus: 'error'`.
 */
async function runComponent(
  component: OnboardingComponent,
  opts: OnboardingOptions
): Promise<ComponentOutcome> {
  const start = Date.now()
  let check: CheckResult
  try {
    opts.onProgress?.(`Checking ${component.name}`)
    check = await component.check()
  } catch (err) {
    log.error('Component check() threw', { component: component.name, error: String(err) })
    return {
      name: component.name,
      finalStatus: 'error',
      check: {
        name: component.name,
        status: 'error',
        message: `check() threw: ${err instanceof Error ? err.message : String(err)}`,
      },
      message: `check() threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    }
  }

  // ok / warn → no install, outcome matches check
  if (check.status === 'ok') {
    return {
      name: component.name,
      finalStatus: 'ok',
      check,
      message: check.message,
      details: check.details,
      durationMs: Date.now() - start,
    }
  }
  if (check.status === 'warn') {
    return {
      name: component.name,
      finalStatus: 'warn',
      check,
      message: check.message,
      remediation: check.remediation,
      details: check.details,
      durationMs: Date.now() - start,
    }
  }
  if (check.status === 'error') {
    return {
      name: component.name,
      finalStatus: 'error',
      check,
      message: check.message,
      remediation: check.remediation,
      details: check.details,
      durationMs: Date.now() - start,
    }
  }

  // missing or broken — install time (unless --check)
  if (opts.checkOnly) {
    return {
      name: component.name,
      finalStatus: 'skipped',
      check,
      message: `${check.message} (check-only mode, not installing)`,
      remediation: check.remediation,
      details: check.details,
      durationMs: Date.now() - start,
    }
  }

  try {
    opts.onProgress?.(`Installing ${component.name}`)
    const install = await component.install(opts)
    const durationMs = Date.now() - start
    switch (install.status) {
      case 'installed':
      case 'noop':
        return {
          name: component.name,
          finalStatus: 'ok',
          check,
          message: install.message,
          details: check.details,
          durationMs,
        }
      case 'skipped':
        return {
          name: component.name,
          finalStatus: 'skipped',
          check,
          message: install.message,
          remediation: check.remediation,
          details: check.details,
          durationMs,
        }
      case 'failed':
        return {
          name: component.name,
          finalStatus: 'error',
          check,
          message: install.message,
          remediation: check.remediation,
          details: check.details,
          durationMs,
        }
    }
  } catch (err) {
    log.error('Component install() threw', { component: component.name, error: String(err) })
    return {
      name: component.name,
      finalStatus: 'error',
      check,
      message: `install() threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: check.remediation,
      details: check.details,
      durationMs: Date.now() - start,
    }
  }
}

/**
 * Special-case handling for runtime. Its install() is always a noop -
 * Bakin does not manage the runtime, it only detects it. So we read the
 * check result directly and translate any non-ok status into the
 * appropriate outcome for the orchestrator to cascade-skip on.
 */
async function runRuntimeInline(component: OnboardingComponent, onProgress?: (message: string) => void): Promise<ComponentOutcome> {
  const start = Date.now()
  let check: CheckResult
  try {
    onProgress?.('Checking runtime')
    check = await component.check()
    if (check.status === 'broken' && check.details?.emptyRoster === true) {
      // First-run state: the roster is empty because initialize() is
      // write-free and nothing has provisioned yet. Onboarding IS a
      // sanctioned provisioning call site — seed and re-check. Integrity
      // breakage never carries the marker and is never auto-touched.
      onProgress?.('Runtime roster is empty — provisioning (first-run seed)')
      const { provisionRuntimeForOnboarding } = await import('./runtime')
      await provisionRuntimeForOnboarding()
      check = await component.check()
    }
  } catch (err) {
    return {
      name: component.name,
      finalStatus: 'error',
      check: {
        name: component.name,
        status: 'error',
        message: `check() threw: ${err instanceof Error ? err.message : String(err)}`,
      },
      message: `check() threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    }
  }

  const base = {
    name: component.name,
    check,
    message: check.message,
    remediation: check.remediation,
    details: check.details,
    durationMs: Date.now() - start,
  }

  switch (check.status) {
    case 'ok':
      return { ...base, finalStatus: 'ok' }
    case 'warn':
      return { ...base, finalStatus: 'warn' }
    case 'missing':
      // A missing prerequisite isn't an "error" per se — we just can't
      // proceed. Record as 'error' so the orchestrator writes no marker
      // and the CLI exits 1. The remediation message is the key output.
      return { ...base, finalStatus: 'error' }
    case 'broken':
    case 'error':
      return { ...base, finalStatus: 'error' }
  }
}

/**
 * Run every component's `check()` in dependency order and return the
 * results. Never touches install() — safe for doctor or CI auditing.
 */
export async function checkAll(): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const component of COMPONENT_ORDER) {
    if (!componentApplies(component)) {
      results.push({
        name: component.name,
        status: 'ok',
        message: 'not applicable to the configured runtime adapter (skipped)',
      })
      continue
    }
    try {
      results.push(await component.check())
    } catch (err) {
      results.push({
        name: component.name,
        status: 'error',
        message: `check() threw: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  return results
}

/**
 * Run the full aggregated onboard flow. Safe to call repeatedly —
 * every component is idempotent and the marker file is only written
 * when no component errored.
 */
export async function runOnboard(opts: OnboardingOptions): Promise<RunOnboardResult> {
  // Clear the marker upfront if --force was passed. The user wants to
  // replay the whole flow regardless of prior state.
  if (opts.force) {
    opts.onProgress?.('Clearing previous onboarding marker')
    clearMarker()
  }

  const outcomes: ComponentOutcome[] = []

  for (let i = 0; i < COMPONENT_ORDER.length; i++) {
    const component = COMPONENT_ORDER[i]

    // Adapter applicability: never check/install components that don't
    // apply to the configured runtime (e.g. openclaw-integration on Pi).
    if (!componentApplies(component)) {
      const skip: ComponentOutcome = {
        name: component.name,
        finalStatus: 'skipped',
        check: { name: component.name, status: 'ok', message: 'not applicable to the configured runtime adapter' },
        message: 'not applicable to the configured runtime adapter (skipped)',
        durationMs: 0,
      }
      outcomes.push(skip)
      opts.onOutcome?.({ name: skip.name, finalStatus: 'skipped', message: skip.message })
      continue
    }

    // Cascade skip: if search is not ok, search-models has nothing to pull with.
    // Skip it before even calling check().
    if (component.name === 'search-models') {
      const search = outcomes.find((o) => o.name === 'search')
      if (search && search.finalStatus !== 'ok') {
        const skip: ComponentOutcome = {
          name: 'search-models',
          finalStatus: 'skipped',
          check: {
            name: 'search-models',
            status: 'missing',
            message: 'Skipped: search adapter binary is required to pull Termite models',
          },
          message: 'Skipped: search adapter binary is required to pull Termite models',
          remediation: 'Install the configured search adapter first via `bakin install search`, then rerun onboarding.',
          durationMs: 0,
        }
        outcomes.push(skip)
        emitOutcome(opts, skip)
        if (opts.json) emitJson(skip)
        continue
      }
    }

    // Runtime setup is a user-managed prerequisite. Its install() is
    // intentionally a noop, so the
    // generic runComponent path — which maps install:noop to ok —
    // would incorrectly mark a missing runtime as ready. Handle it
    // inline: call check() only, derive the outcome from that, and
    // cascade-skip downstream if anything other than ok.
    if (component.name === 'runtime') {
      const outcome = await runRuntimeInline(component, opts.onProgress)
      outcomes.push(outcome)
      emitOutcome(opts, outcome)
      if (opts.json) emitJson(outcome)
      if (outcome.finalStatus !== 'ok') {
        log.warn('Runtime is not ready; aborting remaining onboarding steps')
        for (let j = i + 1; j < COMPONENT_ORDER.length; j++) {
          const remaining = COMPONENT_ORDER[j]
          const skip: ComponentOutcome = {
            name: remaining.name,
            finalStatus: 'skipped',
            check: {
              name: remaining.name,
              status: 'missing',
              message: 'Skipped: runtime is a prerequisite and is not ready',
            },
            message: 'Skipped: runtime is a prerequisite and is not ready',
            remediation: outcome.remediation,
            durationMs: 0,
          }
          outcomes.push(skip)
          emitOutcome(opts, skip)
          if (opts.json) emitJson(skip)
        }
        break
      }
      continue
    }

    const outcome = await runComponent(component, opts)
    outcomes.push(outcome)
    emitOutcome(opts, outcome)
    if (opts.json) emitJson(outcome)
  }

  // Aggregate exit code
  const hasError = outcomes.some((o) => o.finalStatus === 'error')
  const hasSkippedOrWarn = outcomes.some((o) => o.finalStatus === 'warn' || o.finalStatus === 'skipped')
  const exitCode: 0 | 1 | 2 = hasError ? 1 : hasSkippedOrWarn ? 2 : 0

  // Marker: write iff no errors. Warn/skipped are valid end-states.
  let markerWritten = false
  if (!hasError) {
    const components: Record<string, ComponentStatus> = {}
    for (const o of outcomes) components[o.name] = o.finalStatus
    try {
      opts.onProgress?.('Writing onboarding marker')
      saveState(components, resolveBakinVersion())
      markerWritten = true
    } catch (err) {
      log.error('Failed to write .onboarded marker', err)
    }
  }

  return { outcomes, exitCode, markerWritten }
}
