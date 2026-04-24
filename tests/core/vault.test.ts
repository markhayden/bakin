import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'

const testHome = (() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const home = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  const openclaw = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
  process.env.BAKIN_HOME = home
  process.env.OPENCLAW_HOME = openclaw
  return { home, openclaw }
})()

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome.home,
  getBakinPaths: () => ({
    home: testHome.home,
    memoryLog: join(testHome.home, 'MEMORY-LOG.md'),
    messaging: join(testHome.home, 'messaging.json'),
    audit: join(testHome.home, 'audit.jsonl'),
    assets: join(testHome.home, 'assets'),
    'assets.store': join(testHome.home, 'assets', 'store'),
    'assets.inbox': join(testHome.home, 'assets', 'inbox'),
    'assets.trash': join(testHome.home, 'assets', '.trash'),
    agents: join(testHome.home, 'agents'),
    personas: join(testHome.home, 'team', 'personas'),
    team: join(testHome.home, 'team'),
    heartbeats: join(testHome.home, 'heartbeats'),
    inbox: join(testHome.home, 'inbox'),
    projects: join(testHome.home, 'projects'),
    workflows: join(testHome.home, 'workflows'),
    settings: join(testHome.home, 'settings.json'),
    logs: join(testHome.home, 'logs'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
}))

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
