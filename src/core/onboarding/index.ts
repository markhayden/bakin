/**
 * Onboarding orchestrator — public API for `bakin onboard` and doctor.
 *
 * runOnboard() walks every component in the fixed order of COMPONENT_ORDER.
 *
 * For each component:
 *   0. If one of the components it declares in `requires` did not finish,
 *      skip it (reason `requires`) without checking or installing it.
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
 * What stops what is declared, never hard-coded: each component lists the
 * components it `requires`. A requirement is satisfied by `ok`, `warn` or
 * "does not apply to this runtime"; anything else skips the dependent. So
 * a runtime that cannot be reached skips the steps that need a runtime and
 * nothing else (search, media and the spend check still run), and a
 * search engine that did not install skips only its models.
 *
 * Exit code and marker: see `exitCodeFor`. The marker is written when the
 * exit code is not 1 and the run is not `--check`.
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
import type { CheckResult, InstallableComponent, InstallResult, OnboardingComponent, OnboardingOptions, SkipReason } from './types'
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
export type { CheckResult, InstallResult, OnboardingOptions, OnboardingComponent, InstallableComponent, CheckOnlyComponent, CheckStatus, InstallStatus, SkipReason } from './types'
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
  // Credentials are a fact about the runtime: checked right after it.
  llmComponent,
  searchComponent,
  searchModelsComponent,
  mediaComponent,
  openClawIntegrationComponent,
  pluginAssetsComponent,
  agentSyncComponent,
  modelsComponent,
  budgetComponent,
  channelsComponent,
  recommendedPluginsComponent,
  recommendedAgentsComponent,
  recommendedCapabilitiesComponent,
] as const

/** The recommended extras: optional, fetched from outside, and declinable as a group (`--no-recommended`). */
export const RECOMMENDED_COMPONENTS: readonly string[] = ['recommended-plugins', 'recommended-agents', 'capabilities']

/** Where to get a declined extra later. */
const DECLINED_HINTS: Record<string, string> = {
  'recommended-plugins': 'install plugins any time from Explore or with `bakin install recommended-plugins`',
  'recommended-agents': 'install agents any time from Explore or with `bakin install recommended-agents`',
  capabilities: 'install capability packs any time from Explore or with `bakin install capabilities`',
}

/**
 * The bootstrap phase: the home, its settings and the runtime. They run
 * first and need no answers from the operator; everything after them may.
 */
export const BOOTSTRAP_COMPONENTS: readonly string[] = ['mkdir', 'settings', 'runtime']

/** What the operator chose for the steps after the bootstrap phase. */
export type OnboardingSelections = Pick<OnboardingOptions, 'selectedRecommendedPluginIds' | 'selectedRecommendedAgentIds' | 'approvedComponents'>

export interface OnboardingPhases {
  /**
   * Called once, after the bootstrap components finished and before any
   * other component is looked at. The returned selections apply to the
   * rest of the run. A throw stops onboarding there (nothing after the
   * bootstrap phase runs, no marker is written).
   */
  afterBootstrap?: (bootstrap: readonly ComponentOutcome[]) => Promise<OnboardingSelections | undefined>
}

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
  /** Why, when finalStatus is 'skipped'. Consumers read this, never the message. */
  reason?: SkipReason
  /** The component that was not satisfied, when reason is 'requires'. */
  requires?: string
  /** A typed detail when reason is 'unavailable' (e.g. `no_runnable_model`). */
  code?: string
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
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(outcome.requires ? { requires: outcome.requires } : {}),
    ...(outcome.code ? { code: outcome.code } : {}),
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

  // A pending runtime proposal goes through the settings install even when
  // the file checks ok: the commit, and the comparison with whatever another
  // run stored in the meantime, happen inside that operation and nowhere else.
  const commitsRuntime = component.name === 'settings' && opts.runtimeProposal !== undefined && !opts.checkOnly

  // ok / warn → no install, outcome matches check
  if (check.status === 'ok' && !commitsRuntime) {
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
      reason: 'check_only',
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
      ...(commitsRuntime ? { runtimeAdapter: opts.runtimeProposal } : {}),
      ...(opts.approvedComponents ? { approvedComponents: [...opts.approvedComponents] } : {}),
      ...(opts.selectedRecommendedPluginIds ? { selectedRecommendedPluginIds: [...opts.selectedRecommendedPluginIds] } : {}),
      ...(opts.selectedRecommendedAgentIds ? { selectedRecommendedAgentIds: [...opts.selectedRecommendedAgentIds] } : {}),
    })
    const durationMs = Date.now() - start
    switch (install.status) {
      case 'installed':
      case 'noop': {
        // An install can fix part of what the check found and leave a warning
        // nothing installs away (a model that can't load beside one it
        // re-pulled) — say that, never a bare ok. Only a recheck that WARNS
        // changes the outcome: a service still starting must not turn a
        // successful install into an error.
        const after = await component.check().catch((err: unknown) => {
          log.warn('Post-install recheck failed', { component: component.name, error: String(err) })
          return null
        })
        if (after?.status === 'warn') {
          return {
            name: component.name,
            finalStatus: 'warn',
            check: after,
            message: `${install.message} ${after.message}`,
            remediation: after.remediation,
            details: after.details,
            durationMs: Date.now() - start,
          }
        }
        return {
          name: component.name,
          finalStatus: 'ok',
          check,
          message: install.message,
          details: check.details,
          durationMs,
        }
      }
      case 'skipped':
        return {
          name: component.name,
          finalStatus: 'skipped',
          // An install that skips without saying why was not approved.
          reason: install.reason ?? 'declined',
          ...(install.code ? { code: install.code } : {}),
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
          // A failure a caller must tell apart (a refused runtime choice).
          ...(install.code ? { code: install.code } : {}),
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
 * The first requirement of `component` that did not finish, if any.
 *
 * Satisfied: the required component ended `ok` or `warn`, or does not
 * apply to the active runtime. Under `--check` a required component that
 * declares `usableWhenMissing` also satisfies its dependents when its
 * check merely found it `missing`.
 */
function unmetRequirement(
  component: OnboardingComponent,
  outcomes: readonly ComponentOutcome[],
  opts: OnboardingOptions,
): ComponentOutcome | null {
  for (const name of component.requires) {
    const required = outcomes.find((o) => o.name === name)
    // Not run yet means the order is wrong; the requirements test pins that.
    if (!required) continue
    if (required.finalStatus === 'ok' || required.finalStatus === 'warn') continue
    if (required.finalStatus === 'skipped' && required.reason === 'not_applicable') continue
    if (
      opts.checkOnly
      && required.reason === 'check_only'
      && required.check.status === 'missing'
      && COMPONENT_ORDER.find((c) => c.name === name)?.usableWhenMissing === true
    ) continue
    return required
  }
  return null
}

/**
 * The run's exit code, from statuses and typed reasons alone:
 *  - 1 when any step ended in `error`. A step skipped because it `requires`
 *    another never decides this on its own: its cause is upstream, and only
 *    an upstream error makes the run a failure.
 *  - 2 when the run is as complete as it was allowed to be but not whole:
 *    a warning, or a step skipped for any reason except `not_applicable`.
 *  - 0 otherwise. A step that does not exist on this runtime is not
 *    unfinished work and never affects the code.
 */
export function exitCodeFor(outcomes: ReadonlyArray<Pick<ComponentOutcome, 'finalStatus' | 'reason'>>): 0 | 1 | 2 {
  if (outcomes.some((o) => o.finalStatus === 'error')) return 1
  const unfinished = outcomes.some((o) => o.finalStatus === 'warn' || (o.finalStatus === 'skipped' && o.reason !== 'not_applicable'))
  return unfinished ? 2 : 0
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
export async function runOnboard(
  requested: OnboardingOptions,
  installComponent: ComponentInstaller,
  phases: OnboardingPhases = {},
): Promise<RunOnboardResult> {
  let opts = requested
  let bootstrapped = false
  // Clear the marker upfront if --force was passed. The user wants to
  // replay the whole flow regardless of prior state. Never under --check:
  // a check changes nothing (the CLI refuses the combination outright).
  if (opts.force && !opts.checkOnly) clearMarker()

  const outcomes: ComponentOutcome[] = []

  for (let i = 0; i < COMPONENT_ORDER.length; i++) {
    const component = COMPONENT_ORDER[i]

    // Adapter applicability: never check/install components that don't
    // apply to the configured runtime (e.g. openclaw-integration on Pi).
    if (!componentApplies(component)) {
      const skip: ComponentOutcome = {
        name: component.name,
        finalStatus: 'skipped',
        reason: 'not_applicable',
        check: { name: component.name, status: 'ok', message: 'not applicable to the configured runtime adapter' },
        message: 'not applicable to the configured runtime adapter (skipped)',
        durationMs: 0,
      }
      outcomes.push(skip)
      opts.onOutcome?.({ name: skip.name, finalStatus: 'skipped', message: skip.message })
      // Every component gets a line, including one that does not apply: a
      // consumer never has to infer a step from its absence.
      if (opts.json) emitJson(skip)
      continue
    }

    // Phase boundary: the bootstrap components are done. Whatever the
    // caller decides now (the wizard's answers) applies to the rest.
    if (!bootstrapped && !BOOTSTRAP_COMPONENTS.includes(component.name)) {
      bootstrapped = true
      const decided = await phases.afterBootstrap?.(outcomes)
      if (decided) opts = { ...opts, ...decided }
    }

    // Declined outright: decided before the component is looked at, so
    // nothing is checked, fetched or installed for it.
    if (opts.declinedComponents?.includes(component.name)) {
      const skip: ComponentOutcome = {
        name: component.name,
        finalStatus: 'skipped',
        reason: 'declined',
        check: { name: component.name, status: 'ok', message: 'Declined; not checked' },
        message: `Declined — ${DECLINED_HINTS[component.name] ?? `run \`bakin install ${component.name}\` when you want it`}.`,
        durationMs: 0,
      }
      outcomes.push(skip)
      emitOutcome(opts, skip)
      if (opts.json) emitJson(skip)
      continue
    }

    // Declared requirements: a component whose requirement did not finish
    // is skipped before it is checked, and says which one.
    const unmet = unmetRequirement(component, outcomes, opts)
    if (unmet) {
      const skip: ComponentOutcome = {
        name: component.name,
        finalStatus: 'skipped',
        reason: 'requires',
        requires: unmet.name,
        check: { name: component.name, status: 'missing', message: `Skipped: needs ${unmet.name}, which did not finish` },
        message: `Skipped: needs ${unmet.name}, which did not finish`,
        remediation: unmet.remediation,
        durationMs: 0,
      }
      outcomes.push(skip)
      emitOutcome(opts, skip)
      if (opts.json) emitJson(skip)
      continue
    }

    const outcome = await runComponent(component, opts, installComponent)
    outcomes.push(outcome)
    emitOutcome(opts, outcome)
    if (opts.json) emitJson(outcome)
  }

  const exitCode = exitCodeFor(outcomes)
  const hasError = exitCode === 1

  // Marker: write iff no errors and this was a real run. Warn/skipped are
  // valid end-states; a check proves nothing was set up and writes nothing.
  let markerWritten = false
  if (!hasError && !opts.checkOnly) {
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
