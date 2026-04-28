/**
 * Tests for provenance + user-edit markers (A-3).
 *
 * Coverage:
 *   - writeInstalledBy / readInstalledBy round-trip
 *   - readInstalledBy returns null on missing OR malformed sidecar
 *   - markUserEdited / isUserEdited / unmarkUserEdited
 *   - computeFileSha is content-deterministic
 *   - computeDirSha is recursive + ignores .installedBy / .userEdited sidecars
 *   - File vs directory targets land sidecars in the right place
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-markers-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  computeDirSha,
  computeFileSha,
  installedByPath,
  isUserEdited,
  markUserEdited,
  readInstalledBy,
  removeInstalledBy,
  unmarkUserEdited,
  userEditedPath,
  writeInstalledBy,
  type InstalledByMarker,
} from '../../packages/core/src/agent-packages/markers'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

const NOW = '2026-04-24T12:00:00Z'

function marker(): InstalledByMarker {
  return {
    package: 'pixel',
    version: '0.1.0',
    ref: 'v0.1.0',
    commitSha: 'abc123',
    sha256: 'deadbeef',
    installedAt: NOW,
  }
}

describe('installedByPath', () => {
  it('appends .installedBy as a suffix for file targets', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    expect(installedByPath(target)).toBe(`${target}.installedBy`)
  })

  it('places .installedBy inside the directory for directory targets', () => {
    const target = join(testDir, 'image-generation')
    mkdirSync(target)
    expect(installedByPath(target)).toBe(join(target, '.installedBy'))
  })
})

describe('writeInstalledBy / readInstalledBy round-trip', () => {
  it('round-trips for a file target', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    writeInstalledBy(target, marker())
    expect(readInstalledBy(target)).toEqual(marker())
  })

  it('round-trips for a directory target', () => {
    const target = join(testDir, 'image-generation')
    mkdirSync(target)
    writeFileSync(join(target, 'SKILL.md'), 'body')
    writeInstalledBy(target, marker())
    expect(readInstalledBy(target)).toEqual(marker())
  })

  it('returns null when the sidecar is missing', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    expect(readInstalledBy(target)).toBeNull()
  })

  it('returns null on malformed JSON (does not throw)', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    writeFileSync(`${target}.installedBy`, '{ this is not json', 'utf-8')
    expect(readInstalledBy(target)).toBeNull()
  })

  it('returns null on schema-incompatible JSON', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    writeFileSync(`${target}.installedBy`, JSON.stringify({ package: 'p' }), 'utf-8')
    expect(readInstalledBy(target)).toBeNull()
  })

  it('refuses to write a malformed marker', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    expect(() => writeInstalledBy(target, { package: '' } as InstalledByMarker)).toThrow()
  })

  it('removeInstalledBy is idempotent', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    removeInstalledBy(target) // no-op
    writeInstalledBy(target, marker())
    removeInstalledBy(target)
    expect(readInstalledBy(target)).toBeNull()
  })
})

describe('userEdited sentinel', () => {
  it('isUserEdited returns false when no sentinel exists', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    expect(isUserEdited(target)).toBe(false)
  })

  it('markUserEdited creates the sentinel', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    markUserEdited(target)
    expect(isUserEdited(target)).toBe(true)
  })

  it('markUserEdited is idempotent', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    markUserEdited(target)
    markUserEdited(target)
    expect(isUserEdited(target)).toBe(true)
  })

  it('unmarkUserEdited removes the sentinel', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    markUserEdited(target)
    unmarkUserEdited(target)
    expect(isUserEdited(target)).toBe(false)
  })

  it('unmarkUserEdited is a no-op when sentinel absent', () => {
    const target = join(testDir, 'avatar.jpg')
    writeFileSync(target, 'binary')
    expect(() => unmarkUserEdited(target)).not.toThrow()
  })

  it('userEditedPath places sentinel inside directory for dir targets', () => {
    const target = join(testDir, 'image-generation')
    mkdirSync(target)
    expect(userEditedPath(target)).toBe(join(target, '.userEdited'))
  })
})

describe('computeFileSha', () => {
  it('is content-deterministic', () => {
    const a = join(testDir, 'a.txt')
    const b = join(testDir, 'b.txt')
    writeFileSync(a, 'identical content')
    writeFileSync(b, 'identical content')
    expect(computeFileSha(a)).toBe(computeFileSha(b))
  })

  it('changes when content changes', () => {
    const a = join(testDir, 'a.txt')
    writeFileSync(a, 'content one')
    const sha1 = computeFileSha(a)
    writeFileSync(a, 'content two')
    expect(computeFileSha(a)).not.toBe(sha1)
  })

  it('produces a 64-char hex sha256', () => {
    const a = join(testDir, 'a.txt')
    writeFileSync(a, 'x')
    expect(computeFileSha(a)).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('computeDirSha', () => {
  it('hashes a recursive tree deterministically', () => {
    const dirA = join(testDir, 'tree-a')
    mkdirSync(join(dirA, 'sub'), { recursive: true })
    writeFileSync(join(dirA, 'file1.md'), 'one')
    writeFileSync(join(dirA, 'sub', 'file2.md'), 'two')

    const dirB = join(testDir, 'tree-b')
    mkdirSync(join(dirB, 'sub'), { recursive: true })
    writeFileSync(join(dirB, 'file1.md'), 'one')
    writeFileSync(join(dirB, 'sub', 'file2.md'), 'two')

    expect(computeDirSha(dirA)).toBe(computeDirSha(dirB))
  })

  it('changes when any leaf file changes', () => {
    const dir = join(testDir, 'tree')
    mkdirSync(dir)
    writeFileSync(join(dir, 'a.md'), 'one')
    const initial = computeDirSha(dir)
    writeFileSync(join(dir, 'a.md'), 'two')
    expect(computeDirSha(dir)).not.toBe(initial)
  })

  it('ignores the .installedBy sidecar', () => {
    const dir = join(testDir, 'tree')
    mkdirSync(dir)
    writeFileSync(join(dir, 'SKILL.md'), 'body')
    const before = computeDirSha(dir)
    writeFileSync(join(dir, '.installedBy'), JSON.stringify(marker()), 'utf-8')
    expect(computeDirSha(dir)).toBe(before)
  })

  it('ignores the .userEdited sentinel', () => {
    const dir = join(testDir, 'tree')
    mkdirSync(dir)
    writeFileSync(join(dir, 'SKILL.md'), 'body')
    const before = computeDirSha(dir)
    writeFileSync(join(dir, '.userEdited'), '', 'utf-8')
    expect(computeDirSha(dir)).toBe(before)
  })

  it('is sensitive to filename changes (renames change the hash)', () => {
    const dir = join(testDir, 'tree')
    mkdirSync(dir)
    writeFileSync(join(dir, 'a.md'), 'identical')
    const sha1 = computeDirSha(dir)
    rmSync(join(dir, 'a.md'))
    writeFileSync(join(dir, 'b.md'), 'identical')
    expect(computeDirSha(dir)).not.toBe(sha1)
  })
})
