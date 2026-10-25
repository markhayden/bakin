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
import type { HealthCheckRunInput, HealthIncidentDeclaration } from '@makinbakin/sdk'
import { readPluginSettings } from '../../../../packages/core/src/plugins/settings-store'

const execFileAsync = promisify(execFile)

/** Row 7: a sign-in only the operator can do — a Terminal handoff of `gh auth login`. */
export const GITHUB_READINESS_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'authentication-required', subjectKind: 'system', resolution: { type: 'human', needs: 'credential' }, required: 'owner-decides' },
]

export interface GhProbe {
  /** Resolve the gh binary; null when not installed. */
  which(): Promise<string | null>
  /** Exit-code truth of `gh auth status`. */
  authOk(): Promise<boolean>
  /**
   * Row 7's usage fact: is GitHub work configured here? Today that is the
   * git plugin's `allowedRepoRoots` (the gate on every repo-bound dispatch
   * and worktree); an empty allowlist means no agent can reach a repo, so an
   * unauthenticated gh blocks nothing yet.
   */
  inUse(): Promise<boolean>
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
  async inUse() {
    const roots = readPluginSettings<{ allowedRepoRoots?: unknown }>('git').allowedRepoRoots
    return Array.isArray(roots) && roots.length > 0
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
  const inUse = await probe.inUse()
  const evidence = { installed: true, authenticated: authed, path: ghPath, inUse }
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
      impact: inUse
        ? 'Agents cannot create or update GitHub issues, pull requests, or releases for the repos you allow. Run `gh auth login` and follow the prompts to sign in to GitHub.'
        : 'No repo roots are allowed for agents yet, so nothing is blocked; sign in before you allow one.',
      disposition: inUse ? 'action_required' : 'advisory',
      subject: { kind: 'system', id: 'github-cli', label: 'GitHub CLI' },
      declarationId: 'authentication-required',
      // Row 7: "AR while gh is used" — the git plugin's repo allowlist is the usage fact.
      required: inUse,
      resources: [{ kind: 'system', id: 'github-cli', label: 'GitHub CLI' }],
      resolution: {
        key: 'authenticate',
        type: 'human',
        needs: 'credential',
        label: 'Sign in to GitHub',
        href: '/health',
        handoff: { command: 'gh auth login' },
      },
    },
  })])
}
