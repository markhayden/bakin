/**
 * Centralized OpenClaw home directory resolution.
 * All code that needs to access ~/.openclaw/ paths should use these functions.
 *
 * Respects OPENCLAW_HOME env var for dev/test environments.
 * Falls back to ~/.openclaw/ when unset.
 */
import { join } from 'path'
import { homedir } from 'os'

/** Resolve the OpenClaw home directory. Respects OPENCLAW_HOME env var. */
export function getOpenClawHome(): string {
  return process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
}

/** Resolve a path within the OpenClaw home directory. */
export function getOpenClawPath(...segments: string[]): string {
  return join(getOpenClawHome(), ...segments)
}
