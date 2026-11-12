/**
 * Shared vocabulary for onboarding scenarios: run `bakin onboard --json`,
 * read its outcome lines, read the marker.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { runBakin, type ChildResult, type OnboardingHome, type RunOptions } from '../harness'

/** Deadline for one child. Generous: an observation window, not a speed claim. */
export const CHILD_TIMEOUT = 90_000
/** Per-test timeout: a scenario runs a handful of children. */
export const TEST_TIMEOUT = 240_000

export interface OutcomeLine {
  component: string
  status: string
  message: string
  [key: string]: unknown
}

/**
 * `bakin onboard --json <flags>`. `--json` alone is non-interactive and,
 * without `--yes`, approves no recommended install — so a scenario that
 * goes through here never reaches for the network.
 */
export function onboard(home: OnboardingHome, flags: string[] = [], options: RunOptions = {}): Promise<ChildResult> {
  return runBakin(home, ['onboard', '--json', ...flags], { timeoutMs: CHILD_TIMEOUT, ...options })
}

/** The per-component lines of a run, by component name. */
export function outcomes(result: ChildResult): Record<string, OutcomeLine> {
  const out: Record<string, OutcomeLine> = {}
  for (const line of result.jsonLines) {
    if (typeof line.component === 'string') out[line.component] = line as OutcomeLine
  }
  return out
}

/** Component → status, for comparing two runs. */
export function statuses(result: ChildResult): Record<string, string> {
  return Object.fromEntries(Object.entries(outcomes(result)).map(([name, line]) => [name, line.status]))
}

export function markerPath(home: OnboardingHome): string {
  return join(home.bakinHome, '.onboarded')
}

export interface Marker {
  version: number
  completedAt: string
  components: Record<string, string>
}

/** The marker as written, or null when there is none. Throws on a corrupt one. */
export function readMarker(home: OnboardingHome): Marker | null {
  if (!existsSync(markerPath(home))) return null
  return JSON.parse(readFileSync(markerPath(home), 'utf-8')) as Marker
}

/** What a failing child said, for assertion messages. */
export function describe(result: ChildResult): string {
  return `exit=${String(result.exitCode)} signal=${String(result.signal)} timedOut=${String(result.timedOut)}\nstdout:\n${result.stdout.slice(-2000)}\nstderr:\n${result.stderr.slice(-2000)}`
}
