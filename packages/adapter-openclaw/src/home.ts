/**
 * OpenClaw home directory resolution for the OpenClaw runtime adapter.
 *
 * This is provider-specific and intentionally lives inside
 * packages/adapter-openclaw rather than @bakin/core.
 */
import { homedir } from 'os'
import { join } from 'path'

function defaultHome(): string {
  return join(homedir(), '.openclaw')
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true' || !!process.env.VITEST
}

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
      `[bakin] OpenClaw adapter home resolved to the real OpenClaw home (${real}) `
      + `during a test run. This would write test data to your production instance. `
      + `Fix: set OPENCLAW_HOME to a temp directory before importing the OpenClaw adapter. `
      + `See CLAUDE.md Testing Rules.`,
    )
  }
}

export function getOpenClawHome(): string {
  const resolved = process.env.OPENCLAW_HOME || defaultHome()
  assertSafeForTest(resolved)
  return resolved
}

export function getOpenClawPath(...segments: string[]): string {
  return join(getOpenClawHome(), ...segments)
}

export function resetOpenClawHome(): void {
  // getOpenClawHome reads env every call; no cache to clear.
}
