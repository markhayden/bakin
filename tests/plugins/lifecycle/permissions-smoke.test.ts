/**
 * Smoke tests for the permission taxonomy (commit C8).
 *
 * Coverage at this commit — enum accept/reject, parse helper, did-you-mean
 * suggestion, newPermissions diff. Full coverage in C10.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Required isolation per CLAUDE.md.
const testDir = join(tmpdir(), `bakin-test-permissions-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

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
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

import {
  PermissionSchema,
  PERMISSION_DESCRIPTIONS,
  newPermissions,
  parseManifestPermissions,
  suggestPermission,
} from '../../../packages/core/src/plugins/permissions'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('PermissionSchema', () => {
  it('accepts each known permission', () => {
    for (const perm of PermissionSchema.options) {
      expect(PermissionSchema.parse(perm)).toBe(perm)
    }
  })

  it('rejects unknown strings', () => {
    expect(() => PermissionSchema.parse('network.fetch')).toThrow()
    expect(() => PermissionSchema.parse('storage.delete')).toThrow()
  })

  it('PERMISSION_DESCRIPTIONS has an entry for every enum value', () => {
    for (const perm of PermissionSchema.options) {
      expect(PERMISSION_DESCRIPTIONS[perm]).toBeTruthy()
      expect(typeof PERMISSION_DESCRIPTIONS[perm]).toBe('string')
    }
  })
})

describe('parseManifestPermissions', () => {
  it('normalizes missing/empty input to []', () => {
    expect(parseManifestPermissions(undefined)).toEqual([])
    expect(parseManifestPermissions(null)).toEqual([])
    expect(parseManifestPermissions([])).toEqual([])
  })

  it('parses valid input', () => {
    expect(parseManifestPermissions(['storage.read', 'events.emit'])).toEqual(['storage.read', 'events.emit'])
  })

  it('throws on unknown permission with did-you-mean suggestion', () => {
    expect(() => parseManifestPermissions(['sotrage.read'])).toThrow(/Did you mean "storage.read"/)
  })

  it('throws on unknown permission with no close match', () => {
    expect(() => parseManifestPermissions(['network.fetch'])).toThrow(/Unknown permission "network.fetch"/)
  })

  it('throws on non-array input', () => {
    expect(() => parseManifestPermissions('storage.read')).toThrow(/must be an array/)
  })

  it('throws on non-string entries', () => {
    expect(() => parseManifestPermissions([42])).toThrow(/must be strings/)
  })
})

describe('newPermissions', () => {
  it('returns added permissions only', () => {
    expect(newPermissions(['storage.read'], ['storage.read', 'events.emit'])).toEqual(['events.emit'])
  })

  it('returns [] when permissions are identical', () => {
    expect(newPermissions(['storage.read'], ['storage.read'])).toEqual([])
  })

  it('returns [] when permissions only shrunk', () => {
    expect(newPermissions(['storage.read', 'events.emit'], ['storage.read'])).toEqual([])
  })

  it('ignores unknown strings in next (defense in depth — they would have been rejected upstream)', () => {
    expect(newPermissions(['storage.read'], ['storage.read', 'network.fetch'])).toEqual([])
  })
})

describe('suggestPermission', () => {
  it('returns the closest known permission within edit-distance 2', () => {
    expect(suggestPermission('storaeg.read')).toBe('storage.read')
    expect(suggestPermission('events.emt')).toBe('events.emit')
  })

  it('returns null when no known permission is close enough', () => {
    expect(suggestPermission('network.fetch')).toBe(null)
    expect(suggestPermission('completely.different.thing')).toBe(null)
  })
})
