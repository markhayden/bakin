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
 *        - In --check mode: record as `skipped`, never install
 *        - A check-only component (runtime, credentials) records its
 *          `manualSetup` pointer — Bakin never installs those
 *        - Otherwise: hand the install to the caller's `ComponentInstaller`
 *          (#895: an operation on the server or in-process — the CLI
 *          decides, D11) with explicit options; every prompt was resolved
 *          before onboarding started (the wizard's selections, --yes).
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
import { mediaComponent } from './media'
import { searchModelsComponent } from './search-models'
import { openClawIntegrationComponent } from './openclaw-integration'
import { pluginAssetsComponent } from './plugin-assets'
import { agentSyncComponent } from './agent-sync'
import { llmComponent, channelsComponent } from './credentials'
import { budgetComponent } from './budget'
import { modelsComponent } from './models'
import { recommendedPluginsComponent } from './recommended-plugins'
import { recommendedAgentsComponent } from './recommended-agents'
import { recommendedCapabilitiesComponent } from './recommended-capabilities'
import { saveState, clearMarker } from './state'
import type { OnboardingInstallOptions } from './install-request'
import { isInstallable } from './types'
import type { CheckResult, InstallableComponent, InstallResult, OnboardingComponent, OnboardingOptions } from './types'
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
export type { CheckResult, InstallResult, OnboardingOptions, OnboardingComponent, InstallableComponent, CheckOnlyComponent, CheckStatus, InstallStatus } from './types'
export { isInstallable } from './types'

/**
 * The operator stopped an install (Ctrl-C: cancelled, or detached from a
 * server run). Onboarding stops there — no later component starts and no
 * marker is written; the CLI exits 130.
 */
export class OnboardingInterruptedError extends Error {
  constructor(readonly component: string, message: string) {
    super(message)
    this.name = 'OnboardingInterruptedError'
  }
}

/** Runs one component install as an operation — against the server or in-process (#895 D11). */
export type ComponentInstaller = (component: InstallableComponent, options: OnboardingInstallOptions) => Promise<InstallResult>
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
  mediaComponent,
  openClawIntegrationComponent,
  pluginAssetsComponent,
  agentSyncComponent,
  llmComponent,
  modelsComponent,
  budgetComponent,
  channelsComponent,
  recommendedPluginsComponent,
  recommendedAgentsComponent,
  recommendedCapabilitiesComponent,
] as const

/** The installable component named `name` (the shared request schema already validated it). */
export function installableComponent(name: string): InstallableComponent {
  const component = COMPONENT_ORDER.find((c) => c.name === name)
  if (!component || !isInstallable(component)) throw new Error(`${name} is not an installable onboarding component`)
  return component
}

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
  opts: OnboardingOptions,
  installComponent: ComponentInstaller,
): Promise<ComponentOutcome> {
  const start = Date.now()
  let check: CheckResult
  try {
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

  // Set up outside Bakin: say where (the outcome the old noop install gave).
  if (!isInstallable(component)) {
    return {
      name: component.name,
      finalStatus: 'ok',
      check,
      message: component.manualSetup,
      details: check.details,
      durationMs: Date.now() - start,
    }
  }

  try {
    const install = await installComponent(component, {
      autoApprove: opts.autoApprove,
      allowServiceClaim: false,
      ...(opts.approvedComponents ? { approvedComponents: [...opts.approvedComponents] } : {}),
      ...(opts.selectedRecommendedPluginIds ? { selectedRecommendedPluginIds: [...opts.selectedRecommendedPluginIds] } : {}),
      ...(opts.selectedRecommendedAgentIds ? { selectedRecommendedAgentIds: [...opts.selectedRecommendedAgentIds] } : {}),
    })
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
    if (err instanceof OnboardingInterruptedError) throw err
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
 * Special-case handling for runtime. It is check-only — Bakin does not
 * manage the runtime, it only detects it — and unlike the other check-only
 * components a runtime that is not ok blocks everything after it. So we
 * translate any non-ok status into an error the orchestrator cascades on.
 */
async function runRuntimeInline(component: OnboardingComponent): Promise<ComponentOutcome> {
  const start = Date.now()
  let check: CheckResult
  try {
    check = await component.check()
    if (check.status === 'broken' && check.details?.emptyRoster === true) {
      // First-run state: the roster is empty because initialize() is
      // write-free and nothing has provisioned yet. Onboarding IS a
      // sanctioned provisioning call site — seed and re-check. Integrity
      // breakage never carries the marker and is never auto-touched.
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
/** Throws `OnboardingInterruptedError` when the installer reports the operator stopped an install. */
export async function runOnboard(opts: OnboardingOptions, installComponent: ComponentInstaller): Promise<RunOnboardResult> {
  // Clear the marker upfront if --force was passed. The user wants to
  // replay the whole flow regardless of prior state.
  if (opts.force) clearMarker()

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

    // Runtime setup is a user-managed prerequisite. The generic path
    // records a check-only component's setup pointer as ok, which would
    // mark a missing runtime as ready. Handle it inline: call check()
    // only, derive the outcome from that, and cascade-skip downstream if
    // anything other than ok.
    if (component.name === 'runtime') {
      const outcome = await runRuntimeInline(component)
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

    const outcome = await runComponent(component, opts, installComponent)
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
      saveState(components, resolveBakinVersion())
      markerWritten = true
    } catch (err) {
      log.error('Failed to write .onboarded marker', err)
    }
  }

  return { outcomes, exitCode, markerWritten }
}
