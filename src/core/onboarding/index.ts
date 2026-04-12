/**
 * Onboarding orchestrator — public API for `bakin onboard` and doctor.
 *
 * T1 note: this is the skeleton. `runOnboard()` and `checkAll()` throw until
 * components are wired in through T2–T9. `isOnboarded()` and the state
 * helpers are live from day one so `src/core/doctor.ts` can start consulting
 * the marker file as soon as the gate is added (T13).
 */
import type { CheckResult, OnboardingOptions } from './types'

export { isOnboarded, loadState, saveState, clearMarker, ONBOARDING_VERSION } from './state'
export type { CheckResult, InstallResult, OnboardingOptions, OnboardingComponent, CheckStatus, InstallStatus } from './types'

export interface RunOnboardResult {
  results: CheckResult[]
  exitCode: 0 | 1 | 2
  markerWritten: boolean
}

/**
 * Run every component's `check()` in dependency order and return the results.
 * Never mutates the system — safe to call from doctor or CI.
 *
 * T1: stub. T9 wires in the real component chain.
 */
export async function checkAll(): Promise<CheckResult[]> {
  throw new Error('checkAll() not yet implemented — wired up in T9')
}

/**
 * Run the full aggregated `bakin onboard` flow: check each component, install
 * missing ones (subject to opts), write the .onboarded marker on success.
 *
 * T1: stub. T9 wires in the real orchestrator.
 */
export async function runOnboard(_opts: OnboardingOptions): Promise<RunOnboardResult> {
  throw new Error('runOnboard() not yet implemented — wired up in T9')
}
