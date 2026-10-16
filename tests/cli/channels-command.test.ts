/**
 * `bakin channels {status,verify,reconnect}` — flag parsing, rendering, and
 * the exit-code contract (spec §4.5/§4.10) with the HTTP client mocked.
 * The server's snapshot is the only source; nothing here guesses locally.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { setupTtyCliHarness, jsonResponse } from './helpers/tty-cli-harness'
import type { ChannelReadiness } from '../../packages/core/src/delivery'
import { remediationForState } from '../../packages/core/src/delivery/copy'

const testHome = join(tmpdir(), `bakin-cli-channels-${Date.now()}`)
process.env.BAKIN_HOME = testHome
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }) }))

let readiness: ChannelReadiness
let verifyItems: Array<{ key: string; status: 'pass' | 'fail' | 'skipped'; summary: string }> = []
const apiCalls: string[] = []
mock.module('../../src/cli/http', () => ({
  BASE_URL: 'http://bakin.test',
  apiGet: mock(async (path: string) => { apiCalls.push(`GET ${path}`); return readiness }),
  api: mock(async (path: string, init?: RequestInit) => { apiCalls.push(`${init?.method ?? 'GET'} ${path}`); return { items: verifyItems, readiness } }),
}))

const harness = setupTtyCliHarness({ exitMode: 'always-throws', defaultIsTTY: false })

import { run, renderStatus, statusExitCode, verifyExitCode, reconnectExitCode } from '../../src/cli/commands/channels'

function snapshot(state: ChannelReadiness['connection']['state'], over: Partial<ChannelReadiness> = {}): ChannelReadiness {
  const lastError = state === 'failed' ? { kind: 'auth_failed' as const, message: 'Discord rejected the bot token (401)', at: 'x' } : null
  return {
    runtime: { adapter: state === 'native' ? 'openclaw' : 'pi', deliveryMode: state === 'native' ? 'native' : 'unavailable' },
    owner: state === 'native' ? 'runtime' : 'bridge',
    enabled: state !== 'disabled',
    token: { present: state !== 'missing_token', source: state === 'missing_token' ? null : 'env' },
    guilds: [{ id: '1483917789918920714', name: 'Made In Wyo', joined: state === 'connected' ? true : state === 'degraded' || state === 'disconnected' ? false : null, channelCount: state === 'connected' ? 9 : null }],
    connection: { state, since: '2026-10-06T00:00:00.000Z', lastError, ...(state === 'connected' ? { botUser: { id: 'bot', name: 'Margo' } } : {}) },
    channels: { items: state === 'connected' ? [{ id: 'discord:channel:1', platform: 'discord', label: '#general', capabilities: ['message'] }] : [], source: state === 'connected' ? 'bridge' : 'none', collectedAt: state === 'connected' ? 'x' : null },
    routing: {
      alertChannel: { setting: 'notifications.channel', value: 'discord:channel:1', resolved: state === 'connected' ? 'ok' : 'unverifiable', channelId: 'discord:channel:1' },
      approvalsChannel: { setting: 'approvals.channel', value: null, resolved: 'unset' },
      approvalsEnabled: false,
      aliases: [],
    },
    remediation: remediationForState(state, lastError),
    generatedAt: 'x',
    ...over,
  }
}

const exitCode = async (args: string[]) => {
  try {
    await run(args)
  } catch (err) {
    const match = /^exit:(\d+)$/.exec(err instanceof Error ? err.message : String(err))
    if (match) return Number(match[1])
    throw err
  }
  return 0
}

describe('bakin channels status', () => {
  it('prints the server snapshot — state, owner, token source (never the value), servers, routing, next step — and exits 2 when not deliverable', async () => {
    readiness = snapshot('missing_token')
    apiCalls.length = 0
    expect(await exitCode(['channels', 'status'])).toBe(2)
    expect(apiCalls).toEqual(['GET /api/channels'])
    const out = harness.output()
    expect(out).toContain('State:      missing_token')
    expect(out).toContain('Owner:      bridge')
    expect(out).toContain('Token:      not set')
    expect(out).toContain('1483917789918920714 (Made In Wyo): unknown')
    expect(out).toContain('Next step:  Discord is enabled but its bot token is missing.')
  })

  it('exits 0 when connected and prints the bot identity and channel count; --json prints the raw snapshot', async () => {
    readiness = snapshot('connected')
    expect(await exitCode(['channels', 'status'])).toBe(0)
    expect(harness.output()).toContain('Bot:        Margo (bot)')
    expect(harness.output()).toContain('Channels:   1 (bridge)')
    expect(await exitCode(['channels', 'status', '--json'])).toBe(0)
    expect(JSON.parse(harness.output().split('\n').slice(-1 * harness.output().split('\n').length).join('\n').replace(/^[\s\S]*?(\{[\s\S]*\})$/, '$1')).connection.state).toBe('connected')
  })

  it('status is 0 on a native runtime and labels an env-sourced token', async () => {
    readiness = snapshot('native', { token: { present: true, source: 'env' } })
    expect(await exitCode(['channels', 'status'])).toBe(0)
    expect(harness.output()).toContain('Token:      environment variable')
  })

  it('rejects unknown flags and unknown subcommands', async () => {
    readiness = snapshot('connected')
    expect(await exitCode(['channels', 'status', '--jsn'])).toBe(1)
    expect(harness.errorOutput()).toContain('Unknown flag(s): --jsn')
    expect(await exitCode(['channels', 'bogus'])).toBe(1)
  })
})

describe('bakin channels verify', () => {
  it('POSTs the probe, prints the item table, and exits 0 / 1 / 2 by outcome', async () => {
    readiness = snapshot('connected')
    apiCalls.length = 0
    verifyItems = [{ key: 'gateway', status: 'pass', summary: 'Gateway connected as Margo.' }, { key: 'health', status: 'pass', summary: 'ok' }]
    expect(await exitCode(['channels', 'verify'])).toBe(0)
    expect(apiCalls).toEqual(['POST /api/channels/verify'])
    expect(harness.output()).toContain('Gateway connected as Margo.')
    verifyItems = [{ key: 'gateway', status: 'pass', summary: 'ok' }, { key: 'guild:g1', status: 'fail', summary: 'Bot is not a member of server g1.' }]
    expect(await exitCode(['channels', 'verify'])).toBe(1)
    verifyItems = [{ key: 'gateway', status: 'skipped', summary: 'token missing' }, { key: 'health', status: 'skipped', summary: 'x' }]
    expect(await exitCode(['channels', 'verify'])).toBe(2)
  })
})

describe('bakin channels reconnect', () => {
  it('waits for the settled snapshot and exits by state', async () => {
    harness.fetchMock.mockImplementation(async (input: string) => {
      expect(String(input)).toBe('http://bakin.test/api/channels/reconnect?wait=1')
      return { ...jsonResponse({ readiness: snapshot('connected') }), status: 200 } as Response
    })
    expect(await exitCode(['channels', 'reconnect'])).toBe(0)
    expect(harness.output()).toContain('State:      connected')
  })

  it('exits 1 on failed, 2 when there is nothing to connect, 1 on a wait timeout, 0 with an explanation on a native runtime', async () => {
    harness.fetchMock.mockResolvedValue({ ...jsonResponse({ readiness: snapshot('failed') }), status: 200 } as Response)
    expect(await exitCode(['channels', 'reconnect'])).toBe(1)
    expect(harness.output()).toContain('Last error: auth_failed')

    harness.fetchMock.mockResolvedValue({ ...jsonResponse({ readiness: snapshot('missing_token') }), status: 200 } as Response)
    expect(await exitCode(['channels', 'reconnect'])).toBe(2)

    harness.fetchMock.mockResolvedValue({ ...jsonResponse({ readiness: snapshot('connecting') }), ok: false, status: 202 } as Response)
    expect(await exitCode(['channels', 'reconnect'])).toBe(1)
    expect(harness.output()).toContain('Timed out waiting for the bridge')

    harness.fetchMock.mockResolvedValue({ ...jsonResponse({ error: 'owner_is_runtime', message: 'The active runtime delivers natively; the Bakin bridge is idle by design.' }), ok: false, status: 409 } as Response)
    expect(await exitCode(['channels', 'reconnect'])).toBe(0)
    expect(harness.output()).toContain('delivers natively')
  })
})

describe('pure helpers', () => {
  it('renderStatus never prints a token value and exit codes follow the spec table', () => {
    const lines = renderStatus(snapshot('connected', { token: { present: true, source: 'store' } }))
    expect(lines.join('\n')).toContain('Token:      Bakin store')
    expect(statusExitCode(snapshot('degraded'))).toBe(2)
    expect(verifyExitCode([])).toBe(2)
    expect(reconnectExitCode(snapshot('degraded'), false)).toBe(2)
    expect(reconnectExitCode(snapshot('disconnected'), false)).toBe(1)
    expect(reconnectExitCode(snapshot('connected'), true)).toBe(1)
  })
})
