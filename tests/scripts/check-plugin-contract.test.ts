/** The release contract guard: a family change ships only when every official plugin has a compatible release. */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkContractTransition, checkPublishedManifests, contractFromSource, officialPlugins, reportContractGuard } from '../../scripts/check-plugin-contract'
import type { ArtifactsIndex } from '../../src/core/whiskit/artifacts-index'

const SHA = 'b'.repeat(64)
const published = (pluginId: string, contract: string, range = '>=0.0.1-rc.1'): ArtifactsIndex => ({
  version: 1,
  plugins: { [pluginId]: { latest: '1.0.0', versions: { '1.0.0': { platforms: { neutral: { url: 'https://example.test/x.tgz', sha256: SHA, externalsContract: contract, bakinRange: range } } } } } },
})
const PLUGINS = [
  { id: 'projects', source: 'github:markhayden/bakin-bits-official#plugins/projects' },
  { id: 'terminal', source: 'github:markhayden/bakin-bits-official#plugins/terminal' },
]

describe('checkContractTransition', () => {
  it('passes without fetching anything when the family is unchanged (an additive bump)', async () => {
    const result = await checkContractTransition({
      previousContract: 'react19-sdk-focused-v1',
      currentContract: 'react19-sdk-focused-v2',
      hostVersion: '0.0.1-rc.42',
      plugins: PLUGINS,
      fetchIndex: async () => { throw new Error('must not fetch') },
    })
    expect(result).toEqual({ ok: true, reason: 'same-family', checked: [] })
  })

  it('refuses the rc.41 situation: a new family with plugins still published only for the old one', async () => {
    const result = await checkContractTransition({
      previousContract: 'react19-sdk-makinbakin-v2',
      currentContract: 'react19-sdk-focused-v1',
      hostVersion: '0.0.1-rc.41',
      plugins: PLUGINS,
      fetchIndex: async (source) => source.endsWith('projects')
        ? published('projects', 'react19-sdk-focused-v1', '>=0.0.1-rc.41')
        : published('terminal', 'react19-sdk-makinbakin-v2'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.missing.map((m) => m.id)).toEqual(['terminal'])
    expect(() => reportContractGuard(result)).toThrow(/terminal: no published release runs on react19-sdk-focused-v1/)
  })

  it('passes once every official plugin has published for the new family (bakinRange may require this release)', async () => {
    const result = await checkContractTransition({
      previousContract: 'react19-sdk-makinbakin-v2',
      currentContract: 'react19-sdk-focused-v1',
      hostVersion: '0.0.1-rc.41',
      plugins: PLUGINS,
      fetchIndex: async (source) => published(source.split('/').pop()!, 'react19-sdk-focused-v1', '>=0.0.1-rc.41'),
    })
    expect(result).toEqual({ ok: true, reason: 'all-published', checked: ['projects', 'terminal'] })
  })

  it('an unreadable index refuses (never assumes published), and an unknown previous contract checks everything', async () => {
    const result = await checkContractTransition({
      previousContract: null,
      currentContract: 'react19-sdk-focused-v1',
      hostVersion: '0.0.1-rc.41',
      plugins: PLUGINS.slice(0, 1),
      fetchIndex: async () => { throw new Error('404') },
    })
    expect(result).toMatchObject({ ok: false, missing: [{ id: 'projects', detail: expect.stringContaining('404') }] })
  })
})

describe('guard inputs', () => {
  it('the shipped contract is the focused family at v2 — a release past v1 is a same-family, guard-free transition (#948)', async () => {
    const source = readFileSync(join(import.meta.dir, '../../src/core/whiskit/externals.ts'), 'utf8')
    expect(contractFromSource(source)).toBe('react19-sdk-focused-v2')
    const result = await checkContractTransition({
      previousContract: 'react19-sdk-focused-v1',
      currentContract: contractFromSource(source)!,
      hostVersion: '0.0.1-rc.42',
      plugins: PLUGINS,
      fetchIndex: async () => { throw new Error('must not fetch within one family') },
    })
    expect(result).toEqual({ ok: true, reason: 'same-family', checked: [] })
  })

  it('reads the contract out of externals.ts source', () => {
    expect(contractFromSource("export const EXTERNALS_CONTRACT = 'react19-sdk-makinbakin-v2'\n")).toBe('react19-sdk-makinbakin-v2')
    expect(contractFromSource('nothing here')).toBeNull()
  })

  it('official plugins are the curated non-builtin GitHub plugins', () => {
    expect(officialPlugins({
      entries: [
        { kind: 'plugin', id: 'projects', source: 'github:markhayden/bakin-bits-official#plugins/projects' },
        { kind: 'plugin', id: 'tasks', builtin: true },
        { kind: 'agent', id: 'jessica', source: 'github:markhayden/bakin-bits-official#agents/jessica' },
      ],
    })).toEqual([{ id: 'projects', source: 'github:markhayden/bakin-bits-official#plugins/projects' }])
  })
})

describe('checkPublishedManifests: what this release would install must pass its own manifest check', () => {
  const HOST = { hostContract: 'react19-sdk-focused-v2', hostVersion: '0.0.1-rc.47' }
  /** A real manifest by this host's rules, with one dispatched CLI command. */
  const manifest = (id: string, command: Record<string, unknown> = {}) => JSON.stringify({
    id,
    name: id,
    version: '1.0.0',
    bakin: '>=0.0.1-rc.1',
    description: `${id} plugin`,
    permissions: ['storage.read'],
    contributes: { cliCommands: [{
      name: `${id}:list`,
      usage: `bakin ${id} list`,
      summary: 'List things',
      dispatch: { type: 'execTool', name: `bakin_exec_${id}_list` },
      args: [],
      ...command,
    }] },
  })
  const index = async (source: string) => published(source.split('/').pop()!, 'react19-sdk-focused-v2')

  it('passes, naming each plugin and the version judged, when every manifest parses', async () => {
    const result = await checkPublishedManifests({ ...HOST, plugins: PLUGINS, fetchIndex: index, fetchManifest: async (entry) => manifest(entry.url.includes('x.tgz') ? 'projects' : 'x') })
    expect(result).toEqual({ ok: true, checked: [{ id: 'projects', version: '1.0.0' }, { id: 'terminal', version: '1.0.0' }] })
  })

  it('refuses the rc.47 situation: an unchanged family, and a published plugin whose commands declare no args', async () => {
    let fetched = 0
    const result = await checkPublishedManifests({
      ...HOST,
      plugins: PLUGINS,
      fetchIndex: index,
      // The real parser judges it: the first plugin's command has no `args`.
      fetchManifest: async () => (fetched++ === 0 ? manifest('projects', { args: undefined }) : manifest('terminal')),
    })
    expect(result).toEqual({ ok: false, rejected: [{ id: 'projects', version: '1.0.0', detail: expect.stringContaining('args is required when dispatch is declared') }] })
    // The family check alone lets this through — that is the hole.
    const family = await checkContractTransition({ previousContract: 'react19-sdk-focused-v2', currentContract: 'react19-sdk-focused-v2', hostVersion: HOST.hostVersion, plugins: PLUGINS, fetchIndex: index })
    expect(family.ok).toBe(true)
    if (!family.ok || result.ok) throw new Error('unreachable')
    expect(() => reportContractGuard({ ...family, manifests: result })).toThrow(/would refuse the official plugin releases it installs:\n {2}- projects 1\.0\.0: .*args is required/)
  })

  it('judges the newest release the host can RUN, not the newest published', async () => {
    const two = async (): Promise<ArtifactsIndex> => ({
      version: 1,
      plugins: { projects: { latest: '2.0.0', versions: {
        '1.0.0': { platforms: { neutral: { url: 'https://example.test/one.tgz', sha256: SHA, externalsContract: 'react19-sdk-focused-v2', bakinRange: '>=0.0.1-rc.1' } } },
        '2.0.0': { platforms: { neutral: { url: 'https://example.test/two.tgz', sha256: SHA, externalsContract: 'react19-sdk-focused-v2', bakinRange: '>=0.0.2' } } },
      } } },
    })
    const urls: string[] = []
    const result = await checkPublishedManifests({ ...HOST, plugins: PLUGINS.slice(0, 1), fetchIndex: two, fetchManifest: async (entry) => { urls.push(entry.url); return manifest('projects') } })
    expect(urls).toEqual(['https://example.test/one.tgz'])
    expect(result).toEqual({ ok: true, checked: [{ id: 'projects', version: '1.0.0' }] })
  })

  it('refuses when nothing is installable, the index is unreadable, or the artifact cannot be read', async () => {
    const none = await checkPublishedManifests({ ...HOST, plugins: PLUGINS.slice(0, 1), fetchIndex: async () => published('projects', 'react19-sdk-makinbakin-v2'), fetchManifest: async () => manifest('projects') })
    expect(none).toMatchObject({ ok: false, rejected: [{ id: 'projects', version: null, detail: expect.stringContaining('no published release runs on') }] })
    const unreadable = await checkPublishedManifests({ ...HOST, plugins: PLUGINS.slice(0, 1), fetchIndex: async () => { throw new Error('404') }, fetchManifest: async () => manifest('projects') })
    expect(unreadable).toMatchObject({ ok: false, rejected: [{ id: 'projects', version: null, detail: expect.stringContaining('404') }] })
    const broken = await checkPublishedManifests({ ...HOST, plugins: PLUGINS.slice(0, 1), fetchIndex: index, fetchManifest: async () => { throw new Error('checksum mismatch') } })
    expect(broken).toMatchObject({ ok: false, rejected: [{ id: 'projects', version: '1.0.0', detail: 'checksum mismatch' }] })
  })

  it('a passing report names what was judged', () => {
    const report = reportContractGuard({ ok: true, reason: 'same-family', checked: [], contract: 'react19-sdk-focused-v2', manifests: { ok: true, checked: [{ id: 'projects', version: '0.14.0' }] } })
    expect(report).toContain('unchanged family')
    expect(report).toContain('projects 0.14.0')
  })
})
