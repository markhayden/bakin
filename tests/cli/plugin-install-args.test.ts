import { describe, expect, it } from 'bun:test'

import { parsePluginInstallArgs } from '../../src/core/cli/plugin-install-args'

describe('parsePluginInstallArgs', () => {
  it('parses --ref before the source without treating the ref as source', () => {
    expect(parsePluginInstallArgs(['--ref', 'v1.0.0', 'github:owner/repo#plugins/foo', '--yes'])).toEqual({
      source: 'github:owner/repo#plugins/foo',
      ref: 'v1.0.0',
      yes: true,
      dev: false,
      force: false,
    })
  })

  it('parses --ref=<ref>', () => {
    expect(parsePluginInstallArgs(['github:owner/repo', '--ref=release/2026'])).toEqual({
      source: 'github:owner/repo',
      ref: 'release/2026',
      yes: false,
      dev: false,
      force: false,
    })
  })

  it('rejects missing ref values', () => {
    expect(parsePluginInstallArgs(['github:owner/repo', '--ref']).error).toMatch(/requires a value/)
  })
})
