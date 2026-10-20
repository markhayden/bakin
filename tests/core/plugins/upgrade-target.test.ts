/** The upgrade lanes install only the identity the operator reviewed (#1007 review r3 #1). */
import { describe, expect, it } from 'bun:test'
import { assertUpgradeTarget, UpgradeRefusedError } from '../../../src/core/plugins/upgrade-gate'

describe('assertUpgradeTarget', () => {
  it('nothing reviewed, or a candidate matching every reviewed field, passes', () => {
    expect(() => assertUpgradeTarget('notes', undefined, { version: '2', sha: 'a' })).not.toThrow()
    expect(() => assertUpgradeTarget('notes', { version: '2', sha: 'a' }, { version: '2', sha: 'a' })).not.toThrow()
    // A field the candidate cannot report (the subpath lane has no commit sha) is not compared.
    expect(() => assertUpgradeTarget('notes', { version: '2', sha: 'a' }, { version: '2' })).not.toThrow()
  })

  it('a moved ref, a republished artifact or another version is refused with the drift named', () => {
    expect(() => assertUpgradeTarget('notes', { sha: 'a'.repeat(40) }, { version: '2', sha: 'b'.repeat(40) })).toThrow(UpgradeRefusedError)
    expect(() => assertUpgradeTarget('notes', { version: '2', digest: '1'.repeat(64) }, { version: '2', digest: '2'.repeat(64) })).toThrow(/artifact 222222222222 \(reviewed 111111111111\)/)
    expect(() => assertUpgradeTarget('notes', { version: '2' }, { version: '3' })).toThrow(/version 3 \(reviewed 2\)/)
  })
})
