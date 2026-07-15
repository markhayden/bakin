/**
 * OpenClaw credentialStatus (P2.2) — the presence-only credential parsing
 * relocated out of core's onboarding component. Covers the three
 * auth-profile shapes, credential-field checks, and channel config —
 * names only, never secret material.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = mkdtempSync(join(tmpdir(), 'bakin-test-oc-creds-'))

mock.module('../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => testHome,
  getOpenClawPath: (...parts: string[]) => join(testHome, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../packages/adapter-openclaw/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
const contentDirMock = () => ({
  getContentDir: () => join(testHome, 'bakin'),
  getBakinPaths: () => ({ home: join(testHome, 'bakin'), db: join(testHome, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { listLlmProviders, listLlmCredentials, listLlmCredentialsViaCli, listConfiguredChannels } from '../../packages/adapter-openclaw/src/credential-status'

const authProfilesPath = () => join(testHome, 'agents', 'main', 'agent', 'auth-profiles.json')
const configPath = () => join(testHome, 'openclaw.json')

beforeEach(() => {
  rmSync(testHome, { recursive: true, force: true })
  mkdirSync(join(testHome, 'agents', 'main', 'agent'), { recursive: true })
})

afterAll(() => rmSync(testHome, { recursive: true, force: true }))

describe('listLlmProviders', () => {
  it('empty when auth-profiles.json is missing', () => {
    expect(listLlmProviders()).toEqual([])
  })

  it('empty when the file has no recognizable entries', () => {
    writeFileSync(authProfilesPath(), JSON.stringify({ unrelated: true }))
    expect(listLlmProviders()).toEqual([])
  })

  it('empty when all entries have empty credentials', () => {
    writeFileSync(authProfilesPath(), JSON.stringify([
      { provider: 'anthropic', apiKey: '' },
      { provider: 'openai', apiKey: '   ', token: '', access: '' },
    ]))
    expect(listLlmProviders()).toEqual([])
  })

  it('bare array shape (imitation crab) — only credentialed providers count', () => {
    writeFileSync(authProfilesPath(), JSON.stringify([
      { provider: 'anthropic', apiKey: 'sk-ant-fake' },
      { provider: 'openai', apiKey: '' },
    ]))
    expect(listLlmProviders()).toEqual(['anthropic'])
  })

  it('token auth profiles count', () => {
    writeFileSync(authProfilesPath(), JSON.stringify([
      { provider: 'anthropic', type: 'token', token: 'anthropic-token' },
    ]))
    expect(listLlmProviders()).toEqual(['anthropic'])
  })

  it('Codex OAuth (access/refresh) counts', () => {
    writeFileSync(authProfilesPath(), JSON.stringify([
      { provider: 'openai-codex', type: 'oauth', access: 'access-token', refresh: 'refresh-token' },
    ]))
    expect(listLlmProviders()).toEqual(['openai-codex'])
  })

  it('{ profiles: [...] } shape', () => {
    writeFileSync(authProfilesPath(), JSON.stringify({
      profiles: [
        { provider: 'anthropic', apiKey: 'sk-ant-real' },
        { provider: 'openai', apiKey: 'sk-oai-real' },
      ],
    }))
    expect(listLlmProviders()).toEqual(['anthropic', 'openai'])
  })

  it('{ profiles: { key: {...} } } dict shape', () => {
    writeFileSync(authProfilesPath(), JSON.stringify({
      profiles: {
        'default-anthropic': { provider: 'anthropic', apiKey: 'sk-ant-dict' },
        'codex-oauth': { provider: 'openai-codex', mode: 'oauth', access: 'access-token' },
      },
    }))
    expect(listLlmProviders()).toEqual(['anthropic', 'openai-codex'])
  })

  it('malformed JSON reads as empty (never throws)', () => {
    writeFileSync(authProfilesPath(), 'not-json {{{')
    expect(listLlmProviders()).toEqual([])
  })

  it('scopes to the requested agent', () => {
    mkdirSync(join(testHome, 'agents', 'pixel', 'agent'), { recursive: true })
    writeFileSync(join(testHome, 'agents', 'pixel', 'agent', 'auth-profiles.json'), JSON.stringify([
      { provider: 'grok', apiKey: 'xai-fake' },
    ]))
    expect(listLlmProviders('pixel')).toEqual(['grok'])
    expect(listLlmProviders()).toEqual([])
  })
})

describe('listConfiguredChannels', () => {
  it('empty when config is missing', () => {
    expect(listConfiguredChannels()).toEqual([])
  })

  it('empty when config has no channels key', () => {
    writeFileSync(configPath(), JSON.stringify({ runtime: { auth: { token: 'x' } } }))
    expect(listConfiguredChannels()).toEqual([])
  })

  it('empty when channels is not an object', () => {
    writeFileSync(configPath(), JSON.stringify({ channels: 'wrong-type' }))
    expect(listConfiguredChannels()).toEqual([])
  })

  it('empty when all channel credentials are blank', () => {
    writeFileSync(configPath(), JSON.stringify({
      channels: { discord: { token: '' }, telegram: { apiKey: '   ' } },
    }))
    expect(listConfiguredChannels()).toEqual([])
  })

  it('lists only credentialed channels', () => {
    writeFileSync(configPath(), JSON.stringify({
      channels: { discord: { token: 'fake-discord-token' }, telegram: { apiKey: '' } },
    }))
    expect(listConfiguredChannels()).toEqual(['discord'])
  })

  it('multiple channels with mixed credential field names', () => {
    writeFileSync(configPath(), JSON.stringify({
      channels: {
        discord: { token: 'fake-discord' },
        slack: { token: 'xoxb-fake' },
        telegram: { botToken: 'fake-bot' },
      },
    }))
    expect(listConfiguredChannels()).toEqual(['discord', 'slack', 'telegram'])
  })
})

describe('listLlmCredentialsViaCli (sqlite-era store)', () => {
  it('parses providers + kinds from `models auth list --json`, deduped', async () => {
    const exec = async (args: string[]) => {
      expect(args).toEqual(['models', 'auth', 'list', '--json'])
      return JSON.stringify({
        agentId: 'main',
        profiles: [
          { id: 'anthropic:default', provider: 'anthropic', type: 'token' },
          { id: 'openai:default', provider: 'openai', type: 'oauth' },
          { id: 'openai:hi@example.com', provider: 'openai', type: 'oauth' },
          { id: 'google:default', provider: 'google', type: 'api-key' },
          { id: 'weird', provider: '  ' },
        ],
      })
    }
    expect(await listLlmCredentialsViaCli(exec)).toEqual([
      { provider: 'anthropic', kind: 'oauth' },
      { provider: 'openai', kind: 'oauth' },
      { provider: 'google', kind: 'api-key' },
    ])
  })

  it('passes --agent for an explicit agent id', async () => {
    const seen: string[][] = []
    const exec = async (args: string[]) => {
      seen.push(args)
      return JSON.stringify({ profiles: [] })
    }
    expect(await listLlmCredentialsViaCli(exec, 'pixel')).toEqual([])
    expect(seen[0]).toEqual(['models', 'auth', 'list', '--json', '--agent', 'pixel'])
  })

  it('propagates exec failures (caller decides the fallback)', async () => {
    const exec = async () => { throw new Error('binary missing') }
    await expect(listLlmCredentialsViaCli(exec)).rejects.toThrow('binary missing')
  })
})

describe('listLlmCredentials (kinds from auth-profiles.json)', () => {
  it('api-key fields → api-key; OAuth-only fields → oauth; key wins over both', () => {
    writeFileSync(authProfilesPath(), JSON.stringify([
      { provider: 'google', apiKey: 'k1' },
      { provider: 'openai-codex', access: 'a', refresh: 'r' },
      { provider: 'openai', api_key: 'k', token: 't' },
    ]))
    expect(listLlmCredentials()).toEqual([
      { provider: 'google', kind: 'api-key' },
      { provider: 'openai-codex', kind: 'oauth' },
      { provider: 'openai', kind: 'api-key' },
    ])
  })
})

describe('credentialStatus — JSON + CLI merge (#615: a plugin provider the JSON store misses)', () => {
  it('unions both sources: a codex provider present only via the CLI is reported even when JSON has others', async () => {
    // JSON store knows anthropic; the CLI (plugin-provider aware) also knows
    // openai-codex. Pre-fix, a non-empty JSON suppressed the CLI → codex hidden.
    writeFileSync(authProfilesPath(), JSON.stringify([{ provider: 'anthropic', apiKey: 'k' }]))
    const { createOpenClawRuntimeAdapter } = await import('../../packages/adapter-openclaw/src/index')
    const adapter = createOpenClawRuntimeAdapter({ settings: {} })
    ;(adapter as unknown as { exec: (a: string[]) => Promise<string> }).exec = async () =>
      JSON.stringify({ profiles: [{ provider: 'openai-codex', type: 'oauth' }] })

    const status = await adapter.credentialStatus()
    expect(status.llmProviders.sort()).toEqual(['anthropic', 'openai-codex'])
  })

  it('a CLI failure with a populated JSON store still reports the JSON providers (no false empty)', async () => {
    writeFileSync(authProfilesPath(), JSON.stringify([{ provider: 'anthropic', apiKey: 'k' }]))
    const { createOpenClawRuntimeAdapter } = await import('../../packages/adapter-openclaw/src/index')
    const adapter = createOpenClawRuntimeAdapter({ settings: {} })
    ;(adapter as unknown as { exec: (a: string[]) => Promise<string> }).exec = async () => { throw new Error('cli down') }

    const status = await adapter.credentialStatus()
    expect(status.llmProviders).toEqual(['anthropic'])
  })
})
