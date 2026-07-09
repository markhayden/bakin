/**
 * T15 — manifest `bakin` semver-range compatibility checker.
 *
 * Pure unit tests (no fs, no registry). The checker takes an explicit host
 * version so the dev-build skip (APP_VERSION 0.0.0-dev) is testable alongside
 * real stamped-host comparisons.
 */
import { describe, expect, it, mock } from 'bun:test'
import { semver } from 'bun'
import { join } from 'path'
import { tmpdir } from 'os'

// The checker is pure (no fs), but per CLAUDE.md every plugins-adjacent test
// mocks both content-dir resolvers so an accidental transitive import can
// never touch ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-plugin-compat-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))

import {
  checkBakinRangeCompatibility,
  isWellFormedSemverRange,
  IncompatibleHostError,
} from '../../packages/core/src/plugins/compat'

describe('isWellFormedSemverRange', () => {
  it('accepts the common range forms', () => {
    for (const range of [
      '>=0.5.0',
      '>=0.0.0-dev',
      '^1.0.0',
      '~1.2.3',
      '1.2.3',
      '*',
      '1.x',
      '1.2.x',
      '>=1.0.0 <2.0.0',
      '^1.0.0 || ^2.0.0',
      '1.0.0 - 2.0.0',
      'v1.2.3',
    ]) {
      expect(isWellFormedSemverRange(range), range).toBe(true)
    }
  })

  it('rejects garbage that Bun.semver would silently treat as match-all', () => {
    for (const range of ['banana', '', '   ', 'latest', '>=x.y.z', 'not-a-range', '>=1.0.0 <<2', '1.2.3.4']) {
      expect(isWellFormedSemverRange(range), JSON.stringify(range)).toBe(false)
    }
  })
})

describe('checkBakinRangeCompatibility', () => {
  it('passes a satisfying host version', () => {
    expect(checkBakinRangeCompatibility('>=1.0.0', '1.2.3').ok).toBe(true)
    expect(checkBakinRangeCompatibility('^1.0.0', '1.9.9').ok).toBe(true)
  })

  it('rejects a non-satisfying host with an actionable message naming both versions', () => {
    const result = checkBakinRangeCompatibility('>=0.5.0', '0.4.0')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('>=0.5.0')
      expect(result.message).toContain('0.4.0')
      expect(result.message).toMatch(/upgrade bakin/i)
    }
  })

  it('rejects a caret-range miss', () => {
    expect(checkBakinRangeCompatibility('^1.0.0', '2.0.0').ok).toBe(false)
  })

  it('rejects an invalid range even on a dev host (well-formedness is static)', () => {
    for (const host of ['0.0.0-dev', '1.2.3']) {
      const result = checkBakinRangeCompatibility('banana', host)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain('banana')
    }
  })

  it('skips satisfaction on a dev host (0.0.0-dev) — unstamped builds are version-meaningless', () => {
    expect(checkBakinRangeCompatibility('>=0.5.0', '0.0.0-dev').ok).toBe(true)
    expect(checkBakinRangeCompatibility('>=999.0.0', '0.0.0-dev').ok).toBe(true)
  })

  it('holds the scaffold dev-floor invariant: 0.0.0-dev satisfies >=0.0.0-dev natively', () => {
    // Even without the dev-host skip this must hold — probed against
    // Bun.semver directly so a Bun behavior change surfaces here.
    expect(semver.satisfies('0.0.0-dev', '>=0.0.0-dev')).toBe(true)
    expect(checkBakinRangeCompatibility('>=0.0.0-dev', '0.0.0-dev').ok).toBe(true)
  })

  it('release hosts satisfy the scaffold dev floor', () => {
    expect(checkBakinRangeCompatibility('>=0.0.0-dev', '1.2.3').ok).toBe(true)
  })

  it('documents Bun prerelease semantics: a prerelease host only matches ranges anchored at its own base', () => {
    // Stamped releases are never prereleases in practice (release tags are
    // strict v*), so this is informational — pinned so a Bun change is loud.
    expect(checkBakinRangeCompatibility('>=1.1.0', '1.2.0-beta.1').ok).toBe(false)
  })
})

describe('IncompatibleHostError', () => {
  it('carries the checker message', () => {
    const err = new IncompatibleHostError('plugin "x" requires Bakin >=2.0.0')
    expect(err.message).toContain('>=2.0.0')
    expect(err).toBeInstanceOf(Error)
  })
})
