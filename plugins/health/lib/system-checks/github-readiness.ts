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
import { healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'

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

export async function checkGithubReadiness(probe: GhProbe = defaultGhProbe): Promise<HealthCheckRunInput> {
  const ghPath = await probe.which()
  if (!ghPath) {
    return healthObserved([healthHealthy({
      key: 'github-cli',
      summary: 'GitHub CLI is not installed.',
      detail: 'GitHub CLI is optional. Agents can still do local git work, but issue, pull request, and release operations require gh.',
      evidence: { installed: false, authenticated: false },
    })])
  }

  const authed = await probe.authOk()
  const evidence = { installed: true, authenticated: authed, path: ghPath }
  if (authed) {
    return healthObserved([healthHealthy({
      key: 'github-cli',
      summary: 'GitHub CLI is authenticated.',
      detail: `Agents can use GitHub issues, pull requests, and releases through ${ghPath}.`,
      evidence,
    })])
  }

  return healthObserved([healthWarning({
    key: 'github-cli',
    summary: 'GitHub CLI needs authentication.',
    detail: `GitHub CLI is installed at ${ghPath}, but GitHub operations will fail until it is authenticated.`,
    evidence,
    incident: {
      key: 'authentication-required',
      title: 'GitHub CLI needs authentication',
      impact: 'Agents cannot create or update GitHub issues, pull requests, or releases.',
      disposition: 'action_required',
      resources: [{ kind: 'system', id: 'github-cli', label: 'GitHub CLI' }],
      resolution: {
        key: 'authenticate',
        type: 'instructions',
        label: 'Authenticate GitHub CLI',
        steps: ['Run `gh auth login` and follow the prompts to sign in to GitHub.'],
        command: 'gh auth login',
      },
    },
  })])
}
