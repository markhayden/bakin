/** ONE canonical entry per package id (newest installedAt) — the selection the updates engine, Team and Explore share (PR 8 review r1 #6). */
import { describe, expect, it } from 'bun:test'
import { canonicalPackageEntries, findAgentPackage, packageIdOfLockKey, type Lockfile, type PackageEntry } from '../../packages/core/src/agent-packages/lockfile'

const entry = (over: Partial<PackageEntry>): PackageEntry => ({ kind: 'agent', version: '1.0.0', source: 'github:acme/pixel', ref: 'main', commitSha: 'a'.repeat(40), installedAt: '2026-10-01T00:00:00.000Z', agentId: 'pixel', ...over })

describe('canonicalPackageEntries', () => {
  it('a superseded key still present never wins: the newest installedAt is canonical in BOTH insertion orders', () => {
    const v1 = entry({ version: '1.0.0', installedAt: '2026-10-01T00:00:00.000Z' })
    const v2 = entry({ version: '2.0.0', installedAt: '2026-10-15T00:00:00.000Z' })
    const oldFirst: Lockfile = { version: 1, packages: { 'pixel@1.0.0': v1, 'pixel@2.0.0': v2 } }
    const newFirst: Lockfile = { version: 1, packages: { 'pixel@2.0.0': v2, 'pixel@1.0.0': v1 } }
    for (const lock of [oldFirst, newFirst]) {
      expect(canonicalPackageEntries(lock)).toEqual([{ key: 'pixel@2.0.0', id: 'pixel', entry: v2 }])
      expect(findAgentPackage(lock, 'pixel')).toEqual({ id: 'pixel@2.0.0', entry: v2 })
    }
  })

  it('keys without a version and owner-prefixed ids resolve to their id', () => {
    expect(packageIdOfLockKey('editorial')).toBe('editorial')
    expect(packageIdOfLockKey('examples/pixel@0.1.0')).toBe('examples/pixel')
    const lock: Lockfile = { version: 1, packages: { editorial: entry({ kind: 'skill-pack', agentId: undefined }), 'examples/pixel@0.1.0': entry({ agentId: 'pixel' }) } }
    expect(canonicalPackageEntries(lock).map((c) => c.id).sort()).toEqual(['editorial', 'examples/pixel'])
  })
})
