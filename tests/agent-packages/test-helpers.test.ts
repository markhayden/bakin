/**
 * Smoke tests for the shared agent-package test helpers (A-5).
 *
 * The helpers themselves don't need full coverage — but we want a sanity
 * check that the temp dirs land in the expected place, OpenClaw seeding
 * produces a valid roster, fixture installation lays down the manifest,
 * and the leakage scan refuses symlinks.
 */
import { describe, it, expect, mock } from 'bun:test'
import { existsSync, readFileSync, symlinkSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-helpers-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  assertNoLeakage,
  assertProjectionExists,
  installFixtureManifest,
  mockBakinAndOpenClawHomes,
  readSeededOpenClawConfig,
  seedOpenClawAgent,
} from './test-helpers'
import { writeInstalledBy, computeFileSha } from '../../packages/core/src/agent-packages/markers'

const FIXTURE_AGENT = join(
  import.meta.dir,
  '..',
  'fixtures',
  'agent-packages',
  'manifests',
  'agent.json',
)

describe('mockBakinAndOpenClawHomes', () => {
  it('returns disjoint, existing temp directories', () => {
    const homes = mockBakinAndOpenClawHomes('helpers-disjoint')
    try {
      expect(existsSync(homes.bakinDir)).toBe(true)
      expect(existsSync(homes.openClawDir)).toBe(true)
      expect(homes.bakinDir).not.toBe(homes.openClawDir)
      expect(homes.bakinDir).toContain(tmpdir())
      expect(homes.openClawDir).toContain(tmpdir())
    } finally {
      homes.cleanup()
    }
  })

  it('cleanup removes both directories', () => {
    const homes = mockBakinAndOpenClawHomes('helpers-cleanup')
    homes.cleanup()
    expect(existsSync(homes.bakinDir)).toBe(false)
    expect(existsSync(homes.openClawDir)).toBe(false)
  })

  it('two calls return distinct paths', () => {
    const a = mockBakinAndOpenClawHomes('a')
    const b = mockBakinAndOpenClawHomes('b')
    try {
      expect(a.bakinDir).not.toBe(b.bakinDir)
      expect(a.openClawDir).not.toBe(b.openClawDir)
    } finally {
      a.cleanup()
      b.cleanup()
    }
  })
})

describe('seedOpenClawAgent', () => {
  it('creates a workspace dir + roster entry for a subagent', () => {
    const homes = mockBakinAndOpenClawHomes('seed-sub')
    try {
      seedOpenClawAgent(homes.openClawDir, {
        id: 'pixel',
        identity: { name: 'Pixel', emoji: '🎨' },
        workspaceFiles: { 'SOUL.md': 'pixel soul', 'IDENTITY.md': 'pixel identity' },
      })
      const wsRoot = join(homes.openClawDir, 'workspaces', 'pixel')
      expect(readFileSync(join(wsRoot, 'SOUL.md'), 'utf-8')).toBe('pixel soul')
      const config = readSeededOpenClawConfig(homes.openClawDir)
      expect(config.agents?.list?.[0].id).toBe('pixel')
      expect(config.agents?.list?.[0].identity?.name).toBe('Pixel')
      expect(config.agents?.list?.[0].workspace).toBe(wsRoot)
    } finally {
      homes.cleanup()
    }
  })

  it('uses workspace/ (not workspaces/main/) for the main agent', () => {
    const homes = mockBakinAndOpenClawHomes('seed-main')
    try {
      seedOpenClawAgent(homes.openClawDir, { id: 'main', isMain: true })
      const wsRoot = join(homes.openClawDir, 'workspace')
      expect(existsSync(wsRoot)).toBe(true)
      const config = readSeededOpenClawConfig(homes.openClawDir)
      // Main agent's workspace is the default (not on the entry itself)
      expect(config.agents?.list?.[0].workspace).toBeUndefined()
    } finally {
      homes.cleanup()
    }
  })

  it('replaces the entry on duplicate id (idempotent)', () => {
    const homes = mockBakinAndOpenClawHomes('seed-dup')
    try {
      seedOpenClawAgent(homes.openClawDir, { id: 'pixel', identity: { name: 'V1' } })
      seedOpenClawAgent(homes.openClawDir, { id: 'pixel', identity: { name: 'V2' } })
      const config = readSeededOpenClawConfig(homes.openClawDir)
      expect(config.agents?.list).toHaveLength(1)
      expect(config.agents?.list?.[0].identity?.name).toBe('V2')
    } finally {
      homes.cleanup()
    }
  })
})

describe('installFixtureManifest', () => {
  it('lays down the manifest + extra files', () => {
    const pkgDir = installFixtureManifest({
      fixturePath: FIXTURE_AGENT,
      extraFiles: { 'workspace/SOUL.md': 'soul body' },
    })
    expect(existsSync(join(pkgDir, 'bakin-package.json'))).toBe(true)
    expect(existsSync(join(pkgDir, 'workspace/SOUL.md'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'bakin-package.json'), 'utf-8'))
    expect(manifest.id).toBe('pixel')
  })
})

describe('assertProjectionExists', () => {
  it('passes for an existing file with matching sha', () => {
    const homes = mockBakinAndOpenClawHomes('assert-pass')
    try {
      const target = join(homes.bakinDir, 'avatar.jpg')
      writeFileSync(target, 'binary data')
      const sha = computeFileSha(target)
      expect(() =>
        assertProjectionExists({ target, expectedSha: sha }),
      ).not.toThrow()
    } finally {
      homes.cleanup()
    }
  })

  it('fails when the target is missing', () => {
    expect(() =>
      assertProjectionExists({ target: '/tmp/definitely-not-here-' + Date.now() }),
    ).toThrow(/missing/)
  })

  it('fails on sha mismatch', () => {
    const homes = mockBakinAndOpenClawHomes('assert-mismatch')
    try {
      const target = join(homes.bakinDir, 'avatar.jpg')
      writeFileSync(target, 'binary data')
      expect(() =>
        assertProjectionExists({ target, expectedSha: 'wrongsha' }),
      ).toThrow(/sha256 mismatch/)
    } finally {
      homes.cleanup()
    }
  })

  it('passes when sidecar required + present + valid', () => {
    const homes = mockBakinAndOpenClawHomes('assert-sidecar')
    try {
      const target = join(homes.bakinDir, 'avatar.jpg')
      writeFileSync(target, 'binary data')
      writeInstalledBy(target, {
        package: 'pixel',
        version: '0.1.0',
        ref: 'v0.1.0',
        commitSha: 'abc',
        sha256: computeFileSha(target),
        installedAt: '2026-04-24T00:00:00Z',
      })
      expect(() =>
        assertProjectionExists({ target, requireSidecar: true }),
      ).not.toThrow()
    } finally {
      homes.cleanup()
    }
  })

  it('fails when sidecar required but missing', () => {
    const homes = mockBakinAndOpenClawHomes('assert-no-sidecar')
    try {
      const target = join(homes.bakinDir, 'avatar.jpg')
      writeFileSync(target, 'binary data')
      expect(() =>
        assertProjectionExists({ target, requireSidecar: true }),
      ).toThrow(/Sidecar missing/)
    } finally {
      homes.cleanup()
    }
  })
})

describe('assertNoLeakage', () => {
  it('passes for clean directories', () => {
    const homes = mockBakinAndOpenClawHomes('leak-clean')
    try {
      mkdirSync(join(homes.bakinDir, 'subdir'))
      writeFileSync(join(homes.bakinDir, 'subdir', 'file.txt'), 'ok')
      expect(() =>
        assertNoLeakage(homes.bakinDir, homes.openClawDir),
      ).not.toThrow()
    } finally {
      homes.cleanup()
    }
  })

  it('throws when a symlink is present', () => {
    const homes = mockBakinAndOpenClawHomes('leak-symlink')
    try {
      const targetOutside = join(tmpdir(), 'outside-target-' + Date.now())
      writeFileSync(targetOutside, 'outside')
      symlinkSync(targetOutside, join(homes.bakinDir, 'sneaky-link'))
      expect(() =>
        assertNoLeakage(homes.bakinDir, homes.openClawDir),
      ).toThrow(/Symlink/)
    } finally {
      homes.cleanup()
    }
  })
})
