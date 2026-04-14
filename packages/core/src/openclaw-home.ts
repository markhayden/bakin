/**
 * Centralized OpenClaw home directory resolution.
 * All code that needs to access ~/.openclaw/ paths should use these functions.
 *
 * Respects OPENCLAW_HOME env var for dev/test environments.
 * Falls back to ~/.openclaw/ when unset.
 */
import { join } from 'path'
import { homedir } from 'os'

// Computed lazily (not at module load) so tests that `vi.mock('os', …)` to
// redirect homedir() can still do so — vi.mock hoists the factory above
// module-level code, but the factory body references per-file testHome
// consts that TDZ-error if homedir() runs at import time.
function defaultHome(): string {
  return join(homedir(), '.openclaw')
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true' || !!process.env.VITEST
}

// Refuse to resolve to the developer's REAL ~/.openclaw/ during a test run. A
// misconfigured workflow or tasks test has historically leaked bakin:task:*
// rows into the real OpenClaw flow_runs table. When this guard fires, the fix
// is to mock @bakin/core/openclaw-home or plugins/tasks/lib/flow-store in the
// test, or set OPENCLAW_HOME to a temp directory — never to remove the guard.
//
// The comparison uses process.env.HOME (and a couple of macOS/Linux fallbacks)
// directly instead of os.homedir() so tests that vi.mock('os') to redirect
// homedir() still benefit from the guard — the mock changes the module's
// view, but the real shell $HOME is the thing we're actually protecting.
function realHomeOpenClaw(): string {
  const realHome = process.env.HOME || process.env.USERPROFILE || ''
  if (!realHome) return ''
  return join(realHome, '.openclaw')
}

function assertSafeForTest(path: string): void {
  if (!isTestEnv()) return
  const real = realHomeOpenClaw()
  if (real && path === real) {
    throw new Error(
      `[bakin] getOpenClawHome() resolved to the real OpenClaw home (${real}) `
      + `during a test run. This would write test data to your production instance. `
      + `Fix: mock @bakin/core/openclaw-home (or plugins/tasks/lib/flow-store) in this `
      + `test, or set OPENCLAW_HOME to a temp directory before importing any Bakin `
      + `module. See CLAUDE.md § Testing Rules.`
    )
  }
}

/** Resolve the OpenClaw home directory. Respects OPENCLAW_HOME env var. */
export function getOpenClawHome(): string {
  const resolved = process.env.OPENCLAW_HOME || defaultHome()
  assertSafeForTest(resolved)
  return resolved
}

/** Resolve a path within the OpenClaw home directory. */
export function getOpenClawPath(...segments: string[]): string {
  return join(getOpenClawHome(), ...segments)
}

/**
 * No-op reset for API symmetry with resetContentDir. getOpenClawHome is
 * uncached (reads env var every call), so nothing to reset — but exported so
 * test setup code can call it alongside resetContentDir without conditionals.
 */
export function resetOpenClawHome(): void {
  // intentionally empty
}
