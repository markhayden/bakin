/**
 * GitHub CLI readiness check (pi-parity T3.3) — probe-injected, no real
 * subprocess: absent gh is informational ok, unauthenticated gh warns with
 * remediation, authenticated gh is ok.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-gh-readiness-${Date.now()}`)
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { checkGithubReadiness, type GhProbe } from '../../../plugins/health/lib/system-checks/github-readiness'

const probe = (path: string | null, authed: boolean): GhProbe => ({
  which: async () => path,
  authOk: async () => authed,
})

describe('github readiness check', () => {
  it('reports an absent optional gh installation as healthy', async () => {
    const result = await checkGithubReadiness(probe(null, false))

    expect(result.outcome).toBe('observed')
    if (result.outcome !== 'observed') throw new Error('expected observations')
    expect(result.observations).toEqual([expect.objectContaining({
      key: 'github-cli',
      status: 'healthy',
      summary: 'GitHub CLI is not installed.',
      evidence: { installed: false, authenticated: false },
    })])
  })

  it('reports an unauthenticated gh installation as an actionable warning', async () => {
    const result = await checkGithubReadiness(probe('/opt/homebrew/bin/gh', false))

    expect(result.outcome).toBe('observed')
    if (result.outcome !== 'observed') throw new Error('expected observations')
    const [observation] = result.observations
    expect(observation).toEqual(expect.objectContaining({
      key: 'github-cli',
      status: 'warning',
      summary: 'GitHub CLI needs authentication.',
      evidence: {
        installed: true,
        authenticated: false,
        path: '/opt/homebrew/bin/gh',
      },
    }))
    expect(observation.incident).toEqual(expect.objectContaining({
      key: 'authentication-required',
      disposition: 'action_required',
      resolution: expect.objectContaining({
        type: 'instructions',
        command: 'gh auth login',
      }),
    }))
  })

  it('reports an authenticated gh installation as healthy', async () => {
    const result = await checkGithubReadiness(probe('/opt/homebrew/bin/gh', true))

    expect(result.outcome).toBe('observed')
    if (result.outcome !== 'observed') throw new Error('expected observations')
    expect(result.observations).toEqual([expect.objectContaining({
      key: 'github-cli',
      status: 'healthy',
      summary: 'GitHub CLI is authenticated.',
      evidence: {
        installed: true,
        authenticated: true,
        path: '/opt/homebrew/bin/gh',
      },
    })])
  })
})
