/**
 * Health `capabilities` check — the login family (provider-integrations §4.1,
 * plan 1.5a): a pack whose login is missing or unverified is a human
 * credential incident carrying the setup command and a "Check login" request
 * choice on the shared host control.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-health-capabilities-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

import type { CapabilityReadiness } from '../../../src/core/agent-packages/capability-readiness'

let caps: CapabilityReadiness[] = []
mock.module('../../../src/core/agent-packages/capability-readiness', () => ({ listCapabilities: async () => caps }))

import { capabilityFamily, checkCapabilities } from '../../../plugins/health/lib/system-checks/capabilities'
import { capabilityRemedy } from '../../../src/core/agent-packages/capability-remedy'

function pack(login: CapabilityReadiness['login'][number] | null, over: Partial<CapabilityReadiness> = {}): CapabilityReadiness {
  return {
    capability: 'google-workspace', packageId: 'google-workspace', version: '2.0.0', name: 'Google Workspace', description: '',
    skills: [{ name: 'google-workspace', status: 'ok' }], bins: [{ name: 'gog', status: 'ok' }], npm: [], models: [], prereqs: [],
    login: login ? [login] : [], secrets: [], platformSupported: true, manifestValid: true,
    ready: login === null || login.status === 'ok', missing: login && login.status !== 'ok' ? [`${login.name}: not logged in — run: ${login.setup}`] : [],
    ...over,
  }
}
const setup = 'gog auth setup you@example.com --login'
const base = { name: 'Google account (gog)', setup, help: 'https://gogcli.sh' }

describe('capabilityRemedy — login', () => {
  it('a missing or unverified login is the operator\'s to fix (human), a verified one is ready', () => {
    expect(capabilityRemedy(pack({ ...base, status: 'missing', reason: 'exit' }))).toBe('human')
    expect(capabilityRemedy(pack({ ...base, status: 'unknown', reason: 'never-checked' }))).toBe('human')
    expect(capabilityRemedy(pack({ ...base, status: 'ok', account: 'mark@org.example' }))).toBeNull()
  })

  it('a reinstall or sync need still outranks a login gap', () => {
    expect(capabilityRemedy(pack({ ...base, status: 'missing' }, { bins: [{ name: 'gog', status: 'missing' }] }))).toBe('package-reinstall')
  })
})

describe('capabilityFamily — not-ready-login', () => {
  it('carries the setup command as the handoff and a Check login request on the shared host control', () => {
    const family = capabilityFamily(pack({ ...base, status: 'missing', reason: 'exit' }))!
    expect(family.declarationId).toBe('not-ready-login')
    expect(family.resolution).toMatchObject({
      type: 'human', needs: 'credential', label: 'Log in: Google account (gog)',
      handoff: { command: setup },
      href: '/explore?tab=capabilities&capability=google-workspace',
    })
    const choice = (family.resolution as { choices: Array<Record<string, unknown>> }).choices[0]!
    expect(choice).toMatchObject({ kind: 'request', method: 'POST', url: '/api/packages/login-check', body: { packageId: 'google-workspace' }, effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false } })
  })

  it('an unverified login asks to verify, not to log in', () => {
    const family = capabilityFamily(pack({ ...base, status: 'unknown', reason: 'stale', checkedAt: '2026-11-13T10:00:00.000Z' }))!
    expect(family.declarationId).toBe('not-ready-login')
    expect(family.resolution.label).toBe('Verify login: Google account (gog)')
  })

  it('a missing required secret or prereq is named before the login', () => {
    const family = capabilityFamily(pack({ ...base, status: 'missing' }, {
      prereqs: [{ name: 'GitHub CLI (gh)', kind: 'binary', help: 'https://cli.github.com/', optional: false, status: 'missing' }],
    }))!
    expect(family.declarationId).toBe('not-ready-install')
  })
})

describe('checkCapabilities — login incident', () => {
  it('a logged-out pack is a not-ready incident in the login family; a logged-in one is healthy', async () => {
    caps = [pack({ ...base, status: 'missing', reason: 'exit' })]
    const run = await checkCapabilities({ lockfile: () => ({ version: 1, packages: {} }) as never })
    const obs = (run as { observations: Array<{ status: string; incident?: { declarationId: string; resolution: { key: string } } }> }).observations[0]!
    expect(obs.status).toBe('warning')
    expect(obs.incident).toMatchObject({ declarationId: 'not-ready-login', resolution: { key: 'login' } })

    caps = [pack({ ...base, status: 'ok', account: 'mark@org.example' })]
    const healthy = await checkCapabilities({ lockfile: () => ({ version: 1, packages: {} }) as never })
    expect((healthy as { observations: Array<{ status: string }> }).observations[0]!.status).toBe('healthy')
  })
})
