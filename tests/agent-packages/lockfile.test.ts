/**
 * Tests for the agent-package lockfile schema + atomic IO (A-2).
 *
 * Coverage:
 *   - readLockfile returns empty when file missing; throws on malformed JSON
 *   - writeLockfile is atomic — partial writes don't corrupt existing file
 *   - Pure mutators: addPackage / removePackage / increment / decrement
 *   - getOrphanedPacks excludes agent-kind entries (never orphaned)
 *   - findAgentPackage looks up by agentId
 *   - All file ops are scoped to a temp content-dir (CC-6)
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-lockfile-${Date.now()}`)

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
  type Lockfile,
  type PackageEntry,
  addPackage,
  decrementRefCount,
  findAgentPackage,
  getLockfilePath,
  getOrphanedPacks,
  hasDependents,
  incrementRefCount,
  readLockfile,
  removePackage,
  writeLockfile,
} from '../../packages/core/src/agent-packages/lockfile'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Clean lockfile dir between tests (each gets fresh state)
  const lockfileDir = join(testDir, 'packages')
  if (existsSync(lockfileDir)) rmSync(lockfileDir, { recursive: true, force: true })
})

const NOW = '2026-04-24T12:00:00Z'

function pixelEntry(): PackageEntry {
  return {
    kind: 'agent',
    version: '0.1.0',
    source: 'github:markhayden/bakin-bits-official',
    ref: 'v0.1.0',
    commitSha: 'abc123',
    installedAt: NOW,
    state: 'managed',
    agentId: 'pixel',
    knowledgeEnabled: ['prompt-style-system'],
    projections: [
      { kind: 'asset', target: '/tmp/avatar.jpg', sha256: 'deadbeef' },
    ],
    dependencies: ['markhayden.bakin-skills-visual@0.3.1'],
  }
}

function visualSkillsEntry(): PackageEntry {
  return {
    kind: 'skill-pack',
    version: '0.3.1',
    source: 'github:markhayden/bakin-skills-visual',
    ref: 'v0.3.1',
    commitSha: 'def456',
    installedAt: NOW,
    refCount: 0,
    dependents: [],
  }
}

describe('getLockfilePath', () => {
  it('resolves under the content-dir', () => {
    expect(getLockfilePath()).toBe(join(testDir, 'packages', 'lock.json'))
  })
})

describe('readLockfile', () => {
  it('returns an empty lockfile when the file does not exist', () => {
    const lock = readLockfile()
    expect(lock).toEqual({ version: 1, packages: {} })
  })

  it('parses a valid lockfile', () => {
    const lock: Lockfile = { version: 1, packages: { pixel: pixelEntry() } }
    writeLockfile(lock)
    const round = readLockfile()
    expect(round).toEqual(lock)
  })

  it('throws on invalid JSON', () => {
    mkdirSync(join(testDir, 'packages'), { recursive: true })
    writeFileSync(getLockfilePath(), '{ this is not json', 'utf-8')
    expect(() => readLockfile()).toThrow(/not valid JSON/)
  })

  it('throws on schema violation', () => {
    mkdirSync(join(testDir, 'packages'), { recursive: true })
    writeFileSync(getLockfilePath(), JSON.stringify({ version: 99, packages: {} }), 'utf-8')
    expect(() => readLockfile()).toThrow()
  })
})

describe('writeLockfile (atomic)', () => {
  it('creates the parent directory if missing', () => {
    expect(existsSync(join(testDir, 'packages'))).toBe(false)
    writeLockfile({ version: 1, packages: {} })
    expect(existsSync(getLockfilePath())).toBe(true)
  })

  it('validates input — refuses to write a malformed lockfile', () => {
    const malformed = { version: 1, packages: { foo: { kind: 'mystery' } } } as unknown as Lockfile
    expect(() => writeLockfile(malformed)).toThrow()
    expect(existsSync(getLockfilePath())).toBe(false)
  })

  it('does not leave a tmp file behind on success', () => {
    writeLockfile({ version: 1, packages: { pixel: pixelEntry() } })
    const dir = join(testDir, 'packages')
    const entries = require('fs').readdirSync(dir) as string[]
    const tmpFiles = entries.filter((e) => e.startsWith('lock.json.tmp-'))
    expect(tmpFiles).toHaveLength(0)
  })
})

describe('addPackage / removePackage', () => {
  it('addPackage adds a new entry without mutating the input', () => {
    const lock: Lockfile = { version: 1, packages: {} }
    const next = addPackage(lock, 'pixel', pixelEntry())
    expect(next.packages.pixel).toBeDefined()
    expect(lock.packages.pixel).toBeUndefined() // input untouched
  })

  it('addPackage replaces an existing entry', () => {
    const lock: Lockfile = { version: 1, packages: { pixel: pixelEntry() } }
    const updated = { ...pixelEntry(), commitSha: 'new-sha' }
    const next = addPackage(lock, 'pixel', updated)
    expect(next.packages.pixel?.commitSha).toBe('new-sha')
  })

  it('removePackage drops the entry', () => {
    const lock: Lockfile = { version: 1, packages: { pixel: pixelEntry() } }
    const next = removePackage(lock, 'pixel')
    expect(next.packages.pixel).toBeUndefined()
  })

  it('removePackage is a no-op for unknown ids', () => {
    const lock: Lockfile = { version: 1, packages: {} }
    expect(removePackage(lock, 'ghost')).toBe(lock) // identity, not just equal
  })
})

describe('refCount + dependents', () => {
  function setup(): Lockfile {
    return {
      version: 1,
      packages: {
        'visual@0.3.1': visualSkillsEntry(),
      },
    }
  }

  it('incrementRefCount appends dependent + bumps count', () => {
    const next = incrementRefCount(setup(), 'visual@0.3.1', 'pixel')
    const entry = next.packages['visual@0.3.1']
    expect(entry?.dependents).toEqual(['pixel'])
    expect(entry?.refCount).toBe(1)
  })

  it('incrementRefCount is idempotent for the same dependent', () => {
    let lock = incrementRefCount(setup(), 'visual@0.3.1', 'pixel')
    lock = incrementRefCount(lock, 'visual@0.3.1', 'pixel')
    const entry = lock.packages['visual@0.3.1']
    expect(entry?.dependents).toEqual(['pixel'])
    expect(entry?.refCount).toBe(1)
  })

  it('incrementRefCount tracks multiple dependents', () => {
    let lock = incrementRefCount(setup(), 'visual@0.3.1', 'pixel')
    lock = incrementRefCount(lock, 'visual@0.3.1', 'rolo')
    const entry = lock.packages['visual@0.3.1']
    expect(entry?.dependents).toEqual(['pixel', 'rolo'])
    expect(entry?.refCount).toBe(2)
  })

  it('decrementRefCount removes the dependent + decrements count', () => {
    let lock = incrementRefCount(setup(), 'visual@0.3.1', 'pixel')
    lock = incrementRefCount(lock, 'visual@0.3.1', 'rolo')
    lock = decrementRefCount(lock, 'visual@0.3.1', 'pixel')
    const entry = lock.packages['visual@0.3.1']
    expect(entry?.dependents).toEqual(['rolo'])
    expect(entry?.refCount).toBe(1)
  })

  it('decrementRefCount is a no-op for unknown dependent', () => {
    const lock = incrementRefCount(setup(), 'visual@0.3.1', 'pixel')
    const next = decrementRefCount(lock, 'visual@0.3.1', 'ghost')
    expect(next).toBe(lock)
  })

  it('decrementRefCount never drops below 0', () => {
    const lock = setup()
    const next = decrementRefCount(lock, 'visual@0.3.1', 'pixel')
    expect(next.packages['visual@0.3.1']?.refCount).toBe(0)
  })

  it('hasDependents reflects refCount', () => {
    const empty = setup()
    expect(hasDependents(empty, 'visual@0.3.1')).toBe(false)
    const withDep = incrementRefCount(empty, 'visual@0.3.1', 'pixel')
    expect(hasDependents(withDep, 'visual@0.3.1')).toBe(true)
  })
})

describe('getOrphanedPacks', () => {
  it('excludes agent-kind entries even when they have no dependents', () => {
    const lock: Lockfile = {
      version: 1,
      packages: {
        pixel: pixelEntry(),
        'visual@0.3.1': { ...visualSkillsEntry(), refCount: 0 },
      },
    }
    expect(getOrphanedPacks(lock)).toEqual(['visual@0.3.1'])
  })

  it('returns empty when all non-agent packs have dependents', () => {
    const lock: Lockfile = {
      version: 1,
      packages: {
        'visual@0.3.1': { ...visualSkillsEntry(), refCount: 1, dependents: ['pixel'] },
      },
    }
    expect(getOrphanedPacks(lock)).toEqual([])
  })
})

describe('findAgentPackage', () => {
  it('returns the entry whose agentId matches', () => {
    const lock: Lockfile = { version: 1, packages: { pixel: pixelEntry() } }
    const found = findAgentPackage(lock, 'pixel')
    expect(found?.id).toBe('pixel')
    expect(found?.entry.kind).toBe('agent')
  })

  it('returns null when no agent matches', () => {
    const lock: Lockfile = { version: 1, packages: { pixel: pixelEntry() } }
    expect(findAgentPackage(lock, 'rolo')).toBeNull()
  })

  it('skips non-agent entries even if they share the agentId field', () => {
    const lock: Lockfile = {
      version: 1,
      packages: {
        'visual@0.3.1': visualSkillsEntry(),
      },
    }
    expect(findAgentPackage(lock, 'pixel')).toBeNull()
  })
})

describe('round-trip through writeLockfile + readLockfile', () => {
  it('preserves all fields exactly', () => {
    const lock: Lockfile = {
      version: 1,
      packages: {
        pixel: pixelEntry(),
        'visual@0.3.1': { ...visualSkillsEntry(), refCount: 1, dependents: ['pixel'] },
      },
    }
    writeLockfile(lock)
    const round = readLockfile()
    expect(round).toEqual(lock)
  })
})
