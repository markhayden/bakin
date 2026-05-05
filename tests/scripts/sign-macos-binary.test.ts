import { describe, expect, it } from 'bun:test'
import {
  SIGNING_ENV_KEYS,
  buildSigningPlan,
  formatSigningPlan,
  parseArgs,
  validateSigningInputs,
} from '../../scripts/sign-macos-binary'

const fakeEnv = {
  APPLE_DEVELOPER_ID_CERT_P12_BASE64: 'very-secret-p12',
  APPLE_DEVELOPER_ID_CERT_PASSWORD: 'very-secret-password',
  APPLE_DEVELOPER_IDENTITY: 'Developer ID Application: Example, Inc. (TEAMID1234)',
  APP_STORE_CONNECT_KEY_ID: 'KEY1234567',
  APP_STORE_CONNECT_ISSUER_ID: 'ISSUER-1234',
  APP_STORE_CONNECT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nvery-secret-private-key\\n-----END PRIVATE KEY-----',
  KEYCHAIN_PASSWORD: 'very-secret-keychain-password',
}

describe('parseArgs', () => {
  it('accepts dry-run binary input', () => {
    expect(parseArgs(['--dry-run', '--binary', 'dist/bakin-darwin-arm64'])).toEqual({
      dryRun: true,
      binary: 'dist/bakin-darwin-arm64',
    })
  })

  it('rejects missing or unexpected arguments', () => {
    expect(() => parseArgs(['--binary', '--dry-run'])).toThrow('Usage')
    expect(() => parseArgs(['--binary', 'dist/bakin-darwin-arm64', '--extra'])).toThrow('Unexpected')
  })
})

describe('buildSigningPlan', () => {
  it('keeps signing, notarization, and assessment in the required order', () => {
    const plan = buildSigningPlan({
      binary: 'dist/bakin-darwin-arm64',
      dryRun: true,
      env: fakeEnv,
      tempDir: '/tmp/bakin-signing',
    })

    expect(plan.steps.map((step) => step.label)).toEqual([
      'Write Developer ID certificate',
      'Write App Store Connect private key',
      'Create signing keychain',
      'Set keychain timeout',
      'Unlock signing keychain',
      'Use signing keychain for this job',
      'Set default signing keychain',
      'Import Developer ID certificate',
      'Allow codesign to use the imported key',
      'Sign macOS binary',
      'Verify macOS signature',
      'Zip signed binary for notarization',
      'Submit notarization request',
      'Fetch notarization log on failure',
      'Assess binary with Gatekeeper',
    ])

    const commandNames = plan.steps
      .filter((step) => step.kind === 'command')
      .map((step) => step.command)
    expect(commandNames).toContain('codesign')
    expect(commandNames).toContain('xcrun')
    expect(commandNames).toContain('spctl')
  })

  it('prints a dry-run plan without leaking secrets', () => {
    const plan = buildSigningPlan({
      binary: 'dist/bakin-darwin-arm64',
      dryRun: true,
      env: fakeEnv,
      tempDir: '/tmp/bakin-signing',
    })
    const output = formatSigningPlan(plan)

    expect(output).toContain('<redacted:APPLE_DEVELOPER_ID_CERT_P12_BASE64>')
    expect(output).toContain('<redacted:APPLE_DEVELOPER_ID_CERT_PASSWORD>')
    expect(output).toContain('<redacted:KEYCHAIN_PASSWORD>')
    expect(output).toContain('Checksums are intentionally not computed here.')
    expect(output).not.toContain(fakeEnv.APPLE_DEVELOPER_ID_CERT_P12_BASE64)
    expect(output).not.toContain(fakeEnv.APPLE_DEVELOPER_ID_CERT_PASSWORD)
    expect(output).not.toContain(fakeEnv.APP_STORE_CONNECT_PRIVATE_KEY)
    expect(output).not.toContain(fakeEnv.KEYCHAIN_PASSWORD)
  })
})

describe('validateSigningInputs', () => {
  it('allows dry-run on non-macOS without secrets', () => {
    expect(validateSigningInputs({
      binary: 'dist/bakin-darwin-arm64',
      dryRun: true,
      env: {},
      platform: 'linux',
    })).toBeUndefined()
  })

  it('fails real mode with clear missing-env messages', () => {
    expect(() => validateSigningInputs({
      binary: 'dist/bakin-darwin-arm64',
      dryRun: false,
      env: {},
      platform: 'darwin',
    })).toThrow(SIGNING_ENV_KEYS[0])
  })

  it('refuses real mode outside macOS', () => {
    expect(() => validateSigningInputs({
      binary: 'dist/bakin-darwin-arm64',
      dryRun: false,
      env: fakeEnv,
      platform: 'linux',
    })).toThrow('must run on macOS')
  })
})
