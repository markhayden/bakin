import { describe, expect, it } from 'bun:test'
import { npmViewArgs, runCommand, versionResolves, type CommandResult } from '../../scripts/lib/npm-registry'

function result(partial: Partial<CommandResult>): CommandResult {
  return { status: 1, stdout: '', stderr: '', ...partial }
}

describe('npmViewArgs', () => {
  it('builds the npm view command for an exact version', () => {
    expect(npmViewArgs('@makinbakin/sdk', '0.0.1-rc.8')).toEqual([
      'view',
      '@makinbakin/sdk@0.0.1-rc.8',
      'version',
      '--json',
    ])
  })
})

describe('versionResolves', () => {
  it('returns true when npm view exits 0', () => {
    expect(versionResolves(result({ status: 0, stdout: '"0.0.1-rc.8"\n' }))).toBe(true)
  })

  it('returns false for every recognized "not in registry yet" signal', () => {
    const notFoundSignals = [
      'npm ERR! code E404',
      'npm ERR! 404 Not Found - GET https://registry.npmjs.org/@makinbakin%2fsdk',
      'npm ERR! @makinbakin/sdk@9.9.9 is not in this registry',
      'No match found for version 9.9.9',
    ]
    for (const stderr of notFoundSignals) {
      expect(versionResolves(result({ stderr }))).toBe(false)
    }
  })

  it('detects the not-found signal in stdout as well as stderr', () => {
    expect(versionResolves(result({ stdout: 'E404 not found' }))).toBe(false)
  })

  it('returns null for an ambiguous / real failure so the caller fails loudly', () => {
    expect(versionResolves(result({ stderr: 'npm ERR! network request failed' }))).toBeNull()
    expect(versionResolves(result({ status: null, stderr: 'killed by signal' }))).toBeNull()
  })
})

describe('runCommand timeout', () => {
  it('kills a hung process at the deadline and surfaces a null status (classified as a loud failure)', () => {
    const result = runCommand('sleep', ['5'], process.cwd(), { timeoutMs: 50 })
    expect(result.status).toBeNull()
    expect(versionResolves(result)).toBeNull()
  })
})
