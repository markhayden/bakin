import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Belt-and-suspenders isolation (CLAUDE.md): every fs-touching dependency is
// mocked below, but a future regression that imports a storage module from
// this test must fail safely into a temp dir, never ~/.bakin or ~/.openclaw.
const testDir = join(tmpdir(), `bakin-test-rec-capabilities-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

let lockPackages: Record<string, { kind: string; version: string }> = {}
let readiness: Array<{ capability: string; packageId: string; ready: boolean; missing: string[]; login?: Array<{ name: string; setup: string; help: string; status: string; account?: string; checkedAt?: string }> }> = []
const installCalls: Array<{ source: string; installAs?: string }> = []

mock.module('../../../packages/core/src/agent-packages/lockfile', () => ({
  readLockfile: () => ({ version: 1, packages: lockPackages }),
}))
mock.module('../../../src/core/agent-packages/capability-readiness', () => ({
  listCapabilities: async () => readiness,
}))
mock.module('../../../src/core/agent-packages/installer', () => ({
  installPackage: async (opts: { source: string; installAs?: string }) => {
    installCalls.push(opts)
    return { packageId: opts.installAs ?? 'unknown', kind: 'skill-pack', version: '1.0.0', dependencies: [] }
  },
}))
mock.module('../../../src/core/curated-catalog/load', () => ({
  loadUnifiedCatalog: async () => ({
    version: 2,
    updatedAt: '2026-07-12',
    entries: [
      {
        id: 'web-search-brave', kind: 'skill-pack', name: 'Web Search (Brave)', description: 'x',
        category: 'capability', tags: [], useCases: [], dependencies: [], screenshots: [],
        trust: 'official', builtin: false, defaultSelected: true, ref: 'abc123', runtimes: ['*'],
        capability: 'web-search', source: 'github:markhayden/bakin-bits-official#packs/web-search-brave',
      },
      {
        // Not a capability (no slug) — never recommended by this component.
        id: 'plain-skills', kind: 'skill-pack', name: 'Plain', description: 'x',
        category: 'misc', tags: [], useCases: [], dependencies: [], screenshots: [],
        trust: 'official', builtin: false, defaultSelected: true, ref: null, runtimes: ['*'],
        source: 'github:markhayden/plain-skills',
      },
      {
        // À-la-carte capability pack (NOT defaultSelected) — storefront
        // inventory; must never flip the setup check to missing.
        id: 'transcribe', kind: 'skill-pack', name: 'Audio Transcription', description: 'x',
        category: 'capability', tags: [], useCases: [], dependencies: [], screenshots: [],
        trust: 'official', builtin: false, defaultSelected: false, ref: null, runtimes: ['*'],
        capability: 'transcribe', source: 'github:markhayden/bakin-bits-official#packs/transcribe',
      },
    ],
  }),
}))

import { recommendedCapabilitiesComponent } from '../../../src/core/onboarding/recommended-capabilities'
import { installInOperation } from '../../helpers/operation-harness'

beforeEach(() => {
  lockPackages = {}
  readiness = []
  installCalls.length = 0
})

describe('capabilities onboarding component', () => {
  it('reports missing recommendations when nothing is installed', async () => {
    const result = await recommendedCapabilitiesComponent.check()
    expect(result.status).toBe('missing')
    const recommended = result.details?.recommended as Array<{ id: string }>
    expect(recommended.map(r => r.id)).toEqual(['web-search-brave'])
  })

  it('reports not-ready installed capabilities with remediation', async () => {
    lockPackages['web-search-brave@1.0.0'] = { kind: 'skill-pack', version: '1.0.0' }
    readiness = [{ capability: 'web-search', packageId: 'web-search-brave', ready: false, missing: ['BRAVE_SEARCH_API_KEY is not configured'] }]
    const result = await recommendedCapabilitiesComponent.check()
    expect(result.status).toBe('missing')
    expect(result.remediation).toContain('BRAVE_SEARCH_API_KEY')
  })

  it('a pack whose login is missing is not ready; the remediation is the exact setup command (provider-integrations §4.1)', async () => {
    readiness = [{ capability: 'google-workspace', packageId: 'google-workspace', ready: false, missing: ['Google account (gog): not logged in — run: gog auth setup you@example.com --login'] }]
    const result = await recommendedCapabilitiesComponent.check()
    expect(result.status).toBe('missing')
    expect(result.remediation).toContain('run: gog auth setup you@example.com --login')
  })

  it('uninstalled à-la-carte packs never flip the check to missing', async () => {
    lockPackages = { 'web-search-brave@1.0.0': { kind: 'skill-pack', version: '1.0.0' } }
    readiness = [{ capability: 'web-search', packageId: 'web-search-brave', ready: true, missing: [] }]
    const result = await recommendedCapabilitiesComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('more available in Explore')
  })

  it('is ok when installed and ready', async () => {
    lockPackages['web-search-brave@1.0.0'] = { kind: 'skill-pack', version: '1.0.0' }
    readiness = [{ capability: 'web-search', packageId: 'web-search-brave', ready: true, missing: [] }]
    const result = await recommendedCapabilitiesComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).not.toContain('logged in')
  })

  it('login evidence rides the human message, not only the JSON details (every renderer shows it)', async () => {
    lockPackages['google-workspace@2.0.0'] = { kind: 'skill-pack', version: '2.0.0' }
    lockPackages['web-search-brave@1.0.0'] = { kind: 'skill-pack', version: '1.0.0' }
    readiness = [{
      capability: 'google-workspace', packageId: 'google-workspace', ready: true, missing: [],
      login: [{ name: 'Google account (gog)', setup: 'gog auth setup', help: 'https://x.dev', status: 'ok', account: 'mark@example.com', checkedAt: '2026-11-14T10:03:00.000Z' }],
    }]
    const result = await recommendedCapabilitiesComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('Google account (gog): logged in as mark@example.com (checked 2026-11-14T10:03:00.000Z)')
    expect(result.details?.logins).toEqual([{ packageId: 'google-workspace', name: 'Google account (gog)', status: 'ok', account: 'mark@example.com', checkedAt: '2026-11-14T10:03:00.000Z' }])

    // A not-ready pack beside a logged-in one: the evidence still shows, the fix still leads.
    readiness.push({ capability: 'web-search', packageId: 'web-search-brave', ready: false, missing: ['BRAVE_SEARCH_API_KEY is not configured'] })
    const mixed = await recommendedCapabilitiesComponent.check()
    expect(mixed.status).toBe('missing')
    expect(mixed.remediation).toContain('BRAVE_SEARCH_API_KEY')
    expect(mixed.message).toContain('Google account (gog): logged in as mark@example.com')
  })

  it('installs defaultSelected packs under autoApprove with the ref pin', async () => {
    const result = await installInOperation(recommendedCapabilitiesComponent, { autoApprove: true, allowServiceClaim: false })
    expect(result.status).toBe('installed')
    expect(installCalls).toEqual([{
      source: 'github:markhayden/bakin-bits-official@abc123#packs/web-search-brave',
      installAs: 'web-search-brave',
    }])
  })

  it('skips (never stalls) without autoApprove', async () => {
    const result = await installInOperation(recommendedCapabilitiesComponent, { autoApprove: false, allowServiceClaim: false })
    expect(result.status).toBe('skipped')
    expect(installCalls).toEqual([])
  })
})
