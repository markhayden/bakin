import { describe, expect, it } from 'bun:test'

import {
  createPluginExportManifest,
  installPluginExportManifest,
  parsePluginExportManifest,
  serializePluginExportManifest,
  toPluginImportInstallRequest,
} from '../../../src/core/plugins/import-export'
import type { PluginLockEntry, PluginLockfile } from '../../../packages/core/src/plugins/lockfile'

function entry(overrides: Partial<PluginLockEntry> = {}): PluginLockEntry {
  return {
    source: 'github:example/plugin',
    type: 'github',
    ref: 'main',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    installedAt: '2026-04-29T00:00:00.000Z',
    version: '1.0.0',
    permissions: [],
    manifestSha: 'manifest-sha',
    ...overrides,
  }
}

describe('plugin import/export manifest', () => {
  it('exports the portable lockfile slice needed to reinstall plugins', () => {
    const lockfile: PluginLockfile = {
      version: 1,
      plugins: {
        messaging: entry({
          source: 'github:markhayden/bakin-bits-official#plugins/messaging',
          ref: 'messaging-v1.0.0',
          commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          version: '1.0.0',
        }),
        localdev: entry({
          source: '/Users/dev/localdev',
          type: 'local',
          ref: '',
          commitSha: '',
          version: '0.1.0',
          linked: true,
          linkedSource: '/Users/dev/localdev',
        }),
      },
    }

    expect(createPluginExportManifest(lockfile)).toEqual({
      version: 1,
      plugins: [
        {
          id: 'messaging',
          source: 'github:markhayden/bakin-bits-official#plugins/messaging',
          type: 'github',
          ref: 'messaging-v1.0.0',
          commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          version: '1.0.0',
        },
        {
          id: 'localdev',
          source: '/Users/dev/localdev',
          type: 'local',
          ref: '',
          commitSha: '',
          version: '0.1.0',
          linked: true,
          linkedSource: '/Users/dev/localdev',
        },
      ],
    })
  })

  it('round-trips through JSON and accepts object-shaped lockfile slices', () => {
    const raw = JSON.stringify({
      version: 1,
      plugins: {
        foo: {
          source: 'github:example/foo',
          type: 'github',
          ref: 'v1.0.0',
          commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      },
    })

    const parsed = parsePluginExportManifest(raw)
    expect(parsePluginExportManifest(serializePluginExportManifest(parsed))).toEqual(parsed)
    expect(parsed.plugins[0]).toEqual({
      id: 'foo',
      source: 'github:example/foo',
      type: 'github',
      ref: 'v1.0.0',
      commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
  })

  it('rejects ambiguous or malformed imported entries before installing anything', () => {
    expect(() => parsePluginExportManifest(JSON.stringify({
      version: 1,
      plugins: {
        foo: {
          id: 'bar',
          source: 'github:example/foo',
          type: 'github',
          ref: 'main',
          commitSha: '',
        },
      },
    }))).toThrow(/id field must match object key/)

    expect(() => parsePluginExportManifest(JSON.stringify({
      version: 1,
      plugins: [{
        id: 'foo',
        source: 'github:example/foo',
        type: 'github',
        ref: 'main',
        commitSha: 'not-a-sha',
      }],
    }))).toThrow(/commitSha/)
  })

  it('pins github imports to commitSha and restores linked plugins as dev installs', () => {
    expect(toPluginImportInstallRequest({
      id: 'foo',
      source: 'github:example/foo',
      type: 'github',
      ref: 'main',
      commitSha: 'cccccccccccccccccccccccccccccccccccccccc',
    })).toEqual({
      id: 'foo',
      source: 'github:example/foo',
      type: 'github',
      ref: 'cccccccccccccccccccccccccccccccccccccccc',
      dev: false,
    })

    expect(toPluginImportInstallRequest({
      id: 'bar',
      source: '/tmp/bar',
      type: 'local',
      ref: '',
      commitSha: '',
      linked: true,
      linkedSource: '/tmp/bar',
    })).toEqual({
      id: 'bar',
      source: '/tmp/bar',
      type: 'local',
      ref: undefined,
      dev: true,
    })
  })

  it('retries failed imports so dependency order does not need a separate manifest schema', async () => {
    const installed = new Set<string>()
    const attempted: string[] = []
    const result = await installPluginExportManifest({
      version: 1,
      plugins: [
        { id: 'dependent', source: 'github:example/dependent', type: 'github', ref: 'main', commitSha: '' },
        { id: 'dependency', source: 'github:example/dependency', type: 'github', ref: 'main', commitSha: '' },
      ],
    }, async (request) => {
      attempted.push(request.id)
      if (request.id === 'dependent' && !installed.has('dependency')) {
        throw new Error('missing dependencies: dependency')
      }
      installed.add(request.id)
    })

    expect(result).toEqual({ ok: true, installed: ['dependency', 'dependent'], failed: [] })
    expect(attempted).toEqual(['dependent', 'dependency', 'dependent'])
  })
})
