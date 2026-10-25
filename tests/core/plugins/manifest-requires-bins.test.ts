/**
 * `requires.bins` on bakin-plugin.json (spec: plugin-managed-binaries §2.1).
 *
 * ONE schema: the plugin parser and the capability-pack manifest both import
 * `packages/core/src/plugins/bin-requirement.ts`, so a rule added there
 * (e.g. `sizeBytes`) is visible to both — pinned here.
 */
import { describe, expect, it } from 'bun:test'
import { parsePluginManifest, PluginManifestError } from '../../../packages/core/src/plugins/manifest'
import { safeParseManifest } from '../../../packages/core/src/agent-packages/manifest'
import { BIN_PLATFORM_KEYS, BinRequirementSchema } from '../../../packages/core/src/plugins/bin-requirement'

const SHA = 'a'.repeat(64)
const EXTRACTED = 'b'.repeat(64)
const tmux = {
  name: 'tmux',
  version: '3.7c',
  install: {
    'darwin-arm64': {
      url: 'https://github.com/markhayden/bakin-bits-official/releases/download/mirror/tmux-v3.7c/tmux-3.7c-macos-universal.tar.gz',
      sha256: SHA,
      archive: { format: 'tar.gz', member: 'tmux', extractedSha256: EXTRACTED },
      sizeBytes: 2_100_000,
    },
  },
  verifyArgs: ['-V'],
}
const base = {
  id: 'terminal',
  name: 'Terminal',
  version: '0.2.0',
  bakin: '>=0.0.1-rc.39',
  description: 'Persistent terminals',
}

describe('plugin manifest requires.bins', () => {
  it('parses a valid declaration, including the optional sizeBytes hint', () => {
    const manifest = parsePluginManifest({ ...base, requires: { bins: [tmux] } })
    expect(manifest.requires?.bins).toHaveLength(1)
    const bin = manifest.requires!.bins![0]!
    expect(bin.name).toBe('tmux')
    expect(bin.install['darwin-arm64']?.sha256).toBe(SHA)
    expect(bin.install['darwin-arm64']?.sizeBytes).toBe(2_100_000)
    expect(bin.install['darwin-arm64']?.archive).toEqual({ format: 'tar.gz', member: 'tmux', extractedSha256: EXTRACTED })
    expect(bin.verifyArgs).toEqual(['-V'])
  })

  it('is absent when the manifest declares nothing', () => {
    expect(parsePluginManifest(base).requires).toBeUndefined()
    expect(parsePluginManifest({ ...base, requires: {} }).requires).toBeUndefined()
  })

  it('rejects a malformed entry and names the field', () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ['bad sha', { ...tmux, install: { 'darwin-arm64': { ...tmux.install['darwin-arm64'], sha256: 'nope' } } }, /requires\.bins\[0\].*sha256/],
      ['http url', { ...tmux, install: { 'darwin-arm64': { ...tmux.install['darwin-arm64'], url: 'http://example.com/tmux.tar.gz' } } }, /requires\.bins\[0\].*https/],
      ['traversal member', { ...tmux, install: { 'darwin-arm64': { ...tmux.install['darwin-arm64'], archive: { format: 'tar.gz', member: '../tmux', extractedSha256: EXTRACTED } } } }, /requires\.bins\[0\].*member/],
      // An archive without its extracted pin (every manifest before #898 D) is invalid — never "verified by the marker".
      ['archive without extractedSha256', { ...tmux, install: { 'darwin-arm64': { ...tmux.install['darwin-arm64'], archive: { format: 'tar.gz', member: 'tmux' } } } }, /requires\.bins\[0\].*extractedSha256/],
      ['bad extractedSha256', { ...tmux, install: { 'darwin-arm64': { ...tmux.install['darwin-arm64'], archive: { format: 'tar.gz', member: 'tmux', extractedSha256: 'nope' } } } }, /requires\.bins\[0\].*extractedSha256/],
      ['unknown platform key', { ...tmux, install: { 'windows-x64': tmux.install['darwin-arm64'] } }, /requires\.bins\[0\]/],
      ['no platforms', { ...tmux, install: {} }, /requires\.bins\[0\].*platform/],
      ['bad name', { ...tmux, name: '../tmux' }, /requires\.bins\[0\].*name/],
      ['negative size', { ...tmux, install: { 'darwin-arm64': { ...tmux.install['darwin-arm64'], sizeBytes: -1 } } }, /requires\.bins\[0\].*sizeBytes/],
    ]
    for (const [label, bin, pattern] of cases) {
      expect(() => parsePluginManifest({ ...base, requires: { bins: [bin] } }), label).toThrow(PluginManifestError)
      expect(() => parsePluginManifest({ ...base, requires: { bins: [bin] } }), label).toThrow(pattern)
    }
  })

  it('rejects requires keys plugins do not support (npm/models/prereqs are capability-pack lanes)', () => {
    expect(() => parsePluginManifest({ ...base, requires: { npm: [] } })).toThrow(/requires\.npm/)
    expect(() => parsePluginManifest({ ...base, requires: 'tmux' })).toThrow(/requires must be an object/)
    expect(() => parsePluginManifest({ ...base, requires: { bins: 'tmux' } })).toThrow(/requires\.bins/)
  })

  it('shares ONE schema with capability packs', () => {
    expect(BIN_PLATFORM_KEYS).toContain('darwin-arm64')
    expect(BinRequirementSchema.safeParse(tmux).success).toBe(true)
    // The pack manifest parses the same shape — sizeBytes included — because it imports the shared module.
    const pack = safeParseManifest({
      id: 'demo-pack',
      name: 'Demo',
      version: '1.0.0',
      kind: 'skill-pack',
      description: 'demo',
      capability: 'demo-cap',
      contributions: { skills: ['demo'] },
      requires: { bins: [tmux] },
    })
    expect(pack.success, JSON.stringify(pack.success ? null : pack.error.issues)).toBe(true)
    if (pack.success && pack.data.kind === 'skill-pack') {
      expect(pack.data.requires?.bins?.[0]?.install['darwin-arm64']?.sizeBytes).toBe(2_100_000)
    }
  })

  describe('cliCommands launch', () => {
    const attach = (launch: unknown, method = 'POST') => ({
      name: 'terminal:attach',
      usage: 'bakin terminal attach <ref>',
      summary: 'Attach this terminal',
      dispatch: { type: 'apiRoute', method, path: '/cli/attach', launch },
      args: [{ name: 'ref', type: 'string', positional: true, required: true }],
    })

    it('keeps a launch naming one of the plugin\'s own bins', () => {
      const manifest = parsePluginManifest({ ...base, requires: { bins: [tmux] }, contributes: { cliCommands: [attach({ bin: 'tmux' })] } })
      expect(manifest.contributes?.cliCommands?.[0]?.dispatch).toEqual({ type: 'apiRoute', method: 'POST', path: '/cli/attach', launch: { bin: 'tmux' } })
    })

    it('rejects a launch bin the plugin does not declare in requires.bins', () => {
      expect(() => parsePluginManifest({ ...base, contributes: { cliCommands: [attach({ bin: 'tmux' })] } }))
        .toThrow(/launch\.bin "tmux" must be declared in requires\.bins/)
      expect(() => parsePluginManifest({ ...base, requires: { bins: [tmux] }, contributes: { cliCommands: [attach({ bin: 'zsh' })] } }))
        .toThrow(/launch\.bin "zsh"/)
    })

    it('requires launch to be a POST with a bin name', () => {
      expect(() => parsePluginManifest({ ...base, requires: { bins: [tmux] }, contributes: { cliCommands: [attach({ bin: 'tmux' }, 'GET')] } }))
        .toThrow(/launch requires method POST/)
      expect(() => parsePluginManifest({ ...base, requires: { bins: [tmux] }, contributes: { cliCommands: [attach({})] } }))
        .toThrow(/launch\.bin/)
    })
  })
})
