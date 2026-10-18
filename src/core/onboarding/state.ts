/**
 * .onboarded marker file — "this machine has been through first-run setup."
 *
 * Lives at {BAKIN_HOME}/.onboarded. When the marker is missing and
 * `settings.doctor.requireOnboard` is true, the doctor's `core.onboarded`
 * check raises an action-required incident pointing at `bakin onboard`.
 * Every other check still runs — the marker gates nothing else, so a
 * hand-written marker can only quiet that one incident, never the rest.
 *
 * Bump ONBOARDING_VERSION when onboarding requirements change. A marker with
 * a lower version is treated as missing, forcing users through `bakin onboard`
 * again.
 */
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'

const log = createLogger('onboarding:state')

/**
 * Marker schema version. Increment when the set of components or their
 * contract changes such that an existing marker no longer proves the
 * machine is ready.
 */
export const ONBOARDING_VERSION = 6

export type ComponentStatus = 'ok' | 'warn' | 'skipped' | 'error'

export interface OnboardingState {
  version: number
  completedAt: string
  bakinVersion: string
  components: Record<string, ComponentStatus>
}

function getMarkerPath(): string {
  return join(getContentDir(), '.onboarded')
}

/**
 * Read the marker file. Returns null if missing, unreadable, or corrupt —
 * callers should treat all three as "not onboarded."
 */
export function loadState(): OnboardingState | null {
  const path = getMarkerPath()
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as OnboardingState
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.version !== 'number' ||
      typeof parsed.completedAt !== 'string' ||
      typeof parsed.components !== 'object'
    ) {
      log.warn('Marker file has unexpected shape, treating as not onboarded', { path })
      return null
    }
    return parsed
  } catch (err) {
    log.warn('Failed to read marker file, treating as not onboarded', { path, error: String(err) })
    return null
  }
}

/**
 * Write the marker. Creates the parent directory if missing so this is safe
 * to call even before `bakin mkdir` has seeded ~/.bakin/.
 */
export function saveState(components: Record<string, ComponentStatus>, bakinVersion = '0.0.0'): OnboardingState {
  const path = getMarkerPath()
  mkdirSync(dirname(path), { recursive: true })
  const state: OnboardingState = {
    version: ONBOARDING_VERSION,
    completedAt: new Date().toISOString(),
    bakinVersion,
    components,
  }
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
  log.info('Onboarding marker written', { path, components })
  return state
}

/**
 * True iff a valid marker exists and its version matches the current code.
 * A mismatched (older) version is treated as not onboarded so users get
 * walked through any new components added since their last run.
 */
export function isOnboarded(): boolean {
  const state = loadState()
  return state !== null && state.version >= ONBOARDING_VERSION
}

/**
 * Delete the marker. Used by `bakin onboard --force` to replay the flow.
 */
export function clearMarker(): void {
  const path = getMarkerPath()
  if (existsSync(path)) {
    rmSync(path, { force: true })
    log.info('Onboarding marker cleared', { path })
  }
}
