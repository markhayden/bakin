/** The release contract guard: a family change ships only when every official plugin has a compatible release. */
import { describe, expect, it } from 'bun:test'
import { checkContractTransition, contractFromSource, officialPlugins, reportContractGuard } from '../../scripts/check-plugin-contract'
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
