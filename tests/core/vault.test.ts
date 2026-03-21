import { describe, it, expect, beforeEach } from 'vitest'
import * as vault from '../../src/core/vault'

describe('Vault', () => {
  beforeEach(() => {
    // Vault may already be initialized from other tests — test runtime operations
  })

  it('set and get a credential', () => {
    vault.set('test-key', 'test-value', 'test')
    expect(vault.get('test-key')).toBe('test-value')
  })

  it('returns null for missing credential', () => {
    expect(vault.get('nonexistent-key-12345')).toBeNull()
  })

  it('has() returns correct boolean', () => {
    vault.set('exists-key', 'value', 'test')
    expect(vault.has('exists-key')).toBe(true)
    expect(vault.has('does-not-exist-67890')).toBe(false)
  })

  it('listKeys returns all stored keys', () => {
    vault.set('list-test-a', 'a', 'test')
    vault.set('list-test-b', 'b', 'test')
    const keys = vault.listKeys()
    expect(keys).toContain('list-test-a')
    expect(keys).toContain('list-test-b')
  })

  it('createPluginVault restricts access', () => {
    vault.set('allowed-key', 'allowed-value', 'test')
    vault.set('forbidden-key', 'forbidden-value', 'test')

    const pluginVault = vault.createPluginVault(['allowed-key'])
    expect(pluginVault.get('allowed-key')).toBe('allowed-value')
    expect(pluginVault.get('forbidden-key')).toBeNull()
  })
})
