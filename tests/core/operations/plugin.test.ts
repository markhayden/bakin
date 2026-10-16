/**
 * The ctx.operations rules (#895 D19), shared by the host and the SDK
 * harness: namespacing, owner, origin, and resource authorization.
 */
import { describe, expect, it } from 'bun:test'

import {
  assertPluginResources,
  OperationResourceDeniedError,
  toPluginOperationInput,
  type PluginOperationStartInput,
} from '@bakin/core/operations'

const base: PluginOperationStartInput = {
  kind: 'fetch',
  title: 'Fetch voices',
  fingerprint: 'voices:en',
  plan: { stages: [{ id: 'download', kind: 'downloading', label: 'Download' }], pointOfNoReturn: null },
  run: async () => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: null }),
}

describe('toPluginOperationInput', () => {
  it('namespaces kind and fingerprint and stamps the plugin owner', () => {
    const input = toPluginOperationInput('voice', false, base)
    expect(input).toMatchObject({ kind: 'voice:fetch', fingerprint: 'voice:voices:en', owner: 'plugin:voice', title: 'Fetch voices' })
  })

  it('carries origin from the triggering request, and is system without one', () => {
    const cli = new Request('http://localhost/x', { headers: { 'X-Bakin-Origin': 'cli' } })
    expect(toPluginOperationInput('voice', false, { ...base, request: cli }).origin).toBe('cli')
    expect(toPluginOperationInput('voice', false, { ...base, request: new Request('http://localhost/x') }).origin).toBe('web')
    expect(toPluginOperationInput('voice', false, base).origin).toBe('system')
  })

  it("lets any plugin declare its own resources", () => {
    expect(toPluginOperationInput('voice', false, { ...base, resources: ['voice:models'] }).resources).toEqual(['voice:models'])
  })
})

describe('resource authorization', () => {
  it('rejects a core resource from a user plugin', () => {
    expect(() => assertPluginResources('voice', false, ['media-store'])).toThrow(OperationResourceDeniedError)
    expect(() => assertPluginResources('voice', false, ['media-store'])).toThrow(/reserved for core plugins/)
  })

  it('allows core resources for a core plugin', () => {
    expect(() => assertPluginResources('health', true, ['install-state', 'media-store', 'search-engine'])).not.toThrow()
  })

  it("rejects another plugin's resource for user and core plugins alike", () => {
    expect(() => assertPluginResources('voice', false, ['chat:models'])).toThrow(OperationResourceDeniedError)
    expect(() => assertPluginResources('health', true, ['chat:models'])).toThrow(OperationResourceDeniedError)
  })

  it('rejects an empty name under the plugin prefix', () => {
    expect(() => assertPluginResources('voice', false, ['voice:'])).toThrow(OperationResourceDeniedError)
  })
})
