/**
 * Capability-pack TUI screens: the install consent, the pack's readiness
 * after install, and `bakin packages login-check`. Pure renders — the data
 * shapes are the readiness engine's and the login route's answers.
 */
import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'
import {
  CapabilityStatusReport,
  LoginCheckReport,
  PackInstallConsentReport,
  type CapabilityStatusData,
  type PackInstallPreviewData,
} from '../../src/core/cli/ui/readonly'

const preview = (over: Partial<PackInstallPreviewData> = {}): PackInstallPreviewData => ({
  source: '/packs/demo', origin: '/packs/demo', manifest: 'read', name: 'Demo Pack', version: '1.2.0',
  skills: ['demo'], bins: [{ name: 'tool', version: '3.1.0', host: 'downloads.example.com' }],
  npm: [{ name: 'scripts', dependencies: 2 }], models: [{ name: 'tiny', bytes: 900_000_000 }],
  prereqs: [{ name: 'Docker', optional: true }],
  logins: [{ name: 'Demo account', probe: 'tool auth status', setup: 'tool auth login' }],
  ...over,
})

const cap = (over: Partial<CapabilityStatusData> = {}): CapabilityStatusData => ({
  capability: 'demo', name: 'Demo Pack', ready: true, missing: [],
  skills: [{ name: 'demo', status: 'ok' }], bins: [{ name: 'tool', status: 'ok' }], npm: [], models: [],
  prereqs: [], login: [{ name: 'Demo account', status: 'ok', account: 'me@example.com', checkedAt: '2026-11-14T10:00:00.000Z' }],
  secrets: [], ...over,
})

describe('PackInstallConsentReport', () => {
  it('names every declared download, prereq and login before consent', () => {
    const out = renderToString(<PackInstallConsentReport preview={preview()} color={false} />, { columns: 140 })
    expect(out).toContain('Install Demo Pack')
    expect(out).toContain('v1.2.0')
    expect(out).toContain('tool 3.1.0')
    expect(out).toContain('downloaded from downloads.example.com, sha256-pinned into ~/.bakin/bin')
    expect(out).toContain('2 pinned dependencies into ~/.bakin/npm')
    expect(out).toContain('MB download into ~/.bakin/models')
    expect(out).toContain('Docker (optional)')
    expect(out).toContain('tool auth status')
    expect(out).toContain('Log in with: tool auth login')
  })

  it('says why a manifest could not be read', () => {
    const out = renderToString(<PackInstallConsentReport preview={preview({ manifest: 'unreadable', problem: 'ENOENT', name: undefined, skills: [], bins: [], npm: [], models: [], prereqs: [], logins: [] })} color={false} />, { columns: 140 })
    expect(out).toContain('Install package')
    expect(out).toContain('Could not read the manifest: ENOENT')
  })
})

describe('CapabilityStatusReport', () => {
  it('a ready pack shows the logged-in account on its login row', () => {
    const out = renderToString(<CapabilityStatusReport cap={cap()} color={false} />, { columns: 140 })
    expect(out).toContain('Ready')
    expect(out).toContain('logged in as me@example.com')
    expect(out).not.toContain('NEXT')
  })

  it('a not-ready pack names each reason and the next steps', () => {
    const out = renderToString(<CapabilityStatusReport cap={cap({
      ready: false,
      missing: ['Demo account: needs login — run: tool auth login'],
      login: [{ name: 'Demo account', status: 'missing', reason: 'no-match' }],
      prereqs: [{ name: 'Docker', optional: true, status: 'missing' }],
      secrets: [{ name: 'API key', required: true, status: 'missing' }],
    })} color={false} />, { columns: 140 })
    expect(out).toContain('Not ready')
    expect(out).toContain('1 step left')
    expect(out).toContain('needs login: no logged-in account in the check output')
    expect(out).toContain('not found (optional)')
    expect(out).toContain('not configured')
    expect(out).toContain('NEXT')
    expect(out).toContain('run: tool auth login')
  })
})

describe('LoginCheckReport', () => {
  it('a missing login says how to log in and how to check again', () => {
    const out = renderToString(<LoginCheckReport packageId="demo" receipts={[{ name: 'Demo account', setup: 'tool auth login', status: 'missing', reason: 'exit' }]} color={false} />, { columns: 140 })
    expect(out).toContain('Log in to Demo account: tool auth login')
    expect(out).toContain('Then check again: bakin packages login-check demo')
  })

  it('an unverified login names the reason in words', () => {
    const out = renderToString(<LoginCheckReport packageId="demo" receipts={[{ name: 'Demo account', setup: 'tool auth login', status: 'unknown', reason: 'timeout' }]} color={false} />, { columns: 140 })
    expect(out).toContain('the check timed out')
  })
})
