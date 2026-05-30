/**
 * Shared npm registry helpers for release tooling.
 *
 * Single source of truth for classifying `npm view <pkg>@<version>` results
 * ("resolves" vs "not in registry yet" vs "real error") and for the small
 * command-runner seam that lets release scripts be unit-tested without
 * shelling out. Consumed by both `publish-sdk.ts` and `wait-for-npm-version.ts`.
 */
import { spawnSync } from 'node:child_process'

export interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

export type CommandRunner = (cmd: string, args: string[], cwd: string) => CommandResult

export function runCommand(cmd: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** Args for `npm view <pkg>@<version> version --json`. */
export function npmViewArgs(pkg: string, version: string): string[] {
  return ['view', `${pkg}@${version}`, 'version', '--json']
}

/**
 * Classify the result of `npm view <pkg>@<version> version --json`.
 *   true  → the exact version resolves on the registry (exit 0)
 *   false → the registry reports it does not exist yet (E404 / 404 / not-in-registry)
 *   null  → ambiguous / real failure (network, auth, etc.); caller must fail loudly
 */
export function versionResolves(result: CommandResult): boolean | null {
  if (result.status === 0) return true
  const output = `${result.stdout}\n${result.stderr}`
  if (/E404|404 Not Found|is not in this registry|No match found/i.test(output)) return false
  return null
}
