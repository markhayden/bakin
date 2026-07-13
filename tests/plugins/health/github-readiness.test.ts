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
  it('absent gh is informational ok', async () => {
    const [r] = await checkGithubReadiness(probe(null, false))
    expect(r.status).toBe('ok')
    expect(r.message).toContain('not installed')
  })

  it('unauthenticated gh warns with remediation', async () => {
    const [r] = await checkGithubReadiness(probe('/opt/homebrew/bin/gh', false))
    expect(r.status).toBe('warn')
    expect(r.message).toContain('gh auth login')
  })

  it('authenticated gh is ok', async () => {
    const [r] = await checkGithubReadiness(probe('/opt/homebrew/bin/gh', true))
    expect(r.status).toBe('ok')
    expect(r.message).toContain('authenticated')
  })
})
