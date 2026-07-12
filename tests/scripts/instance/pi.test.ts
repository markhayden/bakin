import { describe, expect, it } from 'bun:test'

import {
  PI_CLI_ENTRY,
  PI_HOME_CONTAINER,
  defaultModelFromAuth,
  patchPiSettings,
  piAgentDir,
  piAuthFile,
  piLoginArgs,
  piLoginEnv,
  piSettingsFile,
  sandboxPiLoginArgs,
} from '../../../scripts/instance/pi'

const HOME = '/tmp/fake-repo/dev/pi-home'
const COMPOSE = '/tmp/fake-repo/dev/docker/docker-compose.yml'

describe('pi paths + env', () => {
  it('derives the agent dir and its files from the pi home', () => {
    expect(piAgentDir(HOME)).toBe(`${HOME}/agent`)
    expect(piAuthFile(HOME)).toBe(`${HOME}/agent/auth.json`)
    expect(piSettingsFile(HOME)).toBe(`${HOME}/agent/settings.json`)
  })

  it('points the SDK CLI at the AGENT dir, not the home (PI_CODING_AGENT_DIR contract)', () => {
    // Bakin's PI_HOME is the parent; the SDK's env var IS the agent dir.
    expect(piLoginEnv(HOME)).toEqual({ PI_CODING_AGENT_DIR: `${HOME}/agent` })
  })

  it('builds the interactive TUI login argv from the pinned SDK CLI', () => {
    // No `pi login` subcommand exists — auth is the TUI's /login slash command.
    expect(piLoginArgs('/repo')).toEqual(['node', `/repo/${PI_CLI_ENTRY}`])
  })

  it('execs the TUI into the sandbox-pi container for sandbox mode', () => {
    expect(sandboxPiLoginArgs(COMPOSE)).toEqual([
      'docker', 'compose', '-f', COMPOSE, 'exec', '-it', 'sandbox-pi',
      'node', `/bakin/${PI_CLI_ENTRY}`,
    ])
  })

  it('pins the container pi home constant', () => {
    expect(PI_HOME_CONTAINER).toBe('/home/node/.pi')
  })
})

describe('defaultModelFromAuth', () => {
  const table = { 'anthropic': 'claude-opus-4-8', 'openai-codex': 'gpt-5.5', 'openai': 'gpt-5.5' }

  it('maps the highest-priority authed provider to provider/model', () => {
    const auth = JSON.stringify({
      'openai-codex': { type: 'oauth', access: 'a', refresh: 'r' },
      'anthropic': { type: 'api_key', key: 'sk' },
    })
    expect(defaultModelFromAuth(auth, table)).toBe('anthropic/claude-opus-4-8')
  })

  it('falls through priority to any table-known provider', () => {
    const auth = JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'a', refresh: 'r' } })
    expect(defaultModelFromAuth(auth, table)).toBe('openai-codex/gpt-5.5')
  })

  it('ignores junk entries and unknown providers', () => {
    expect(defaultModelFromAuth(JSON.stringify({ mystery: { type: 'api_key', key: 'k' } }), table)).toBeNull()
    expect(defaultModelFromAuth(JSON.stringify({ anthropic: null }), table)).toBeNull()
    expect(defaultModelFromAuth('not-json', table)).toBeNull()
    expect(defaultModelFromAuth(JSON.stringify({}), table)).toBeNull()
  })

  it('returns null without a defaults table', () => {
    const auth = JSON.stringify({ anthropic: { type: 'api_key', key: 'sk' } })
    expect(defaultModelFromAuth(auth, null)).toBeNull()
  })
})

describe('patchPiSettings', () => {
  it('writes routing.defaultModel into empty settings', () => {
    expect(JSON.parse(patchPiSettings(null, 'anthropic/claude-opus-4-8')!)).toEqual({
      routing: { defaultModel: 'anthropic/claude-opus-4-8' },
    })
  })

  it('preserves unknown keys and existing routing fields', () => {
    const existing = JSON.stringify({ theme: 'dark', routing: { other: true } })
    expect(JSON.parse(patchPiSettings(existing, 'openai-codex/gpt-5.5')!)).toEqual({
      theme: 'dark',
      routing: { other: true, defaultModel: 'openai-codex/gpt-5.5' },
    })
  })

  it('no-ops (null) when a default model is already set — user choice wins', () => {
    const existing = JSON.stringify({ routing: { defaultModel: 'anthropic/claude-opus-4-8' } })
    expect(patchPiSettings(existing, 'openai-codex/gpt-5.5')).toBeNull()
  })

  it('treats unparseable settings as a no-op (never clobbers)', () => {
    expect(patchPiSettings('{corrupt', 'anthropic/claude-opus-4-8')).toBeNull()
  })
})
