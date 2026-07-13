/**
 * System check — GitHub CLI readiness.
 *
 * Agents do GitHub work (issues, PRs, releases) through the `gh` CLI on any
 * runtime — that IS the parity surface (OpenClaw agents shelled gh too).
 * Absent gh is informational (not every install uses GitHub); a gh that is
 * installed but unauthenticated is the broken half-state worth a warn.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

const execFileAsync = promisify(execFile)

export interface GhProbe {
  /** Resolve the gh binary; null when not installed. */
  which(): Promise<string | null>
  /** Exit-code truth of `gh auth status`. */
  authOk(): Promise<boolean>
}

export const defaultGhProbe: GhProbe = {
  async which() {
    try {
      const { stdout } = await execFileAsync('which', ['gh'], { timeout: 5_000 })
      const path = stdout.trim()
      return path.length > 0 ? path : null
    } catch {
      return null
    }
  },
  async authOk() {
    try {
      await execFileAsync('gh', ['auth', 'status'], { timeout: 10_000 })
      return true
    } catch {
      return false
    }
  },
}

export async function checkGithubReadiness(probe: GhProbe = defaultGhProbe): Promise<HealthCheckResult[]> {
  const ghPath = await probe.which()
  if (!ghPath) {
    return [{
      check: 'github-readiness',
      status: 'ok',
      message: 'GitHub CLI (gh) is not installed — agents can still do local git work via worktree tools. Install gh to add issue/PR/release abilities.',
      autoFixable: false,
    }]
  }
  const authed = await probe.authOk()
  return [{
    check: 'github-readiness',
    status: authed ? 'ok' : 'warn',
    message: authed
      ? `GitHub CLI is installed and authenticated (${ghPath})`
      : `GitHub CLI is installed (${ghPath}) but not authenticated — agents' GitHub operations will fail. Run: gh auth login`,
    autoFixable: false,
  }]
}
