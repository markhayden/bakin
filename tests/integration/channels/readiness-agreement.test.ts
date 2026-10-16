/**
 * Readiness agreement (#908 spec §12.1): ONE real server, FOUR surfaces,
 * ONE answer. Boots Bakin from source on the FAKE Discord transport (D15 —
 * no live Discord) in the margo reproduction state (Pi, Discord enabled, a
 * guild, no Bakin token) and asserts that the API, the post tool, the Health
 * report, and BOTH CLI paths — spawned as separate processes with a DIFFERENT
 * env (a dummy DISCORD_BOT_TOKEN set only for the CLI) — agree on
 * `missing_token` with exactly one incident; then that a rejected token
 * converges to `failed`/`auth_failed`; then that a ready bridge is
 * `connected`, Verify passes, and no channel incident remains.
 *
 * Real HTTP → Bun.fetch (the suite's happy-dom fetch shim cannot open
 * sockets). Each server is killed by pid and its home removed.
 */
import { describe, it, expect, afterAll } from 'bun:test'
import { startIsolatedServer, runCli, realFetch, type IsolatedServer } from '../../helpers/isolated-server'
import { waitUntil } from '../../helpers/wait'

const GUILD = '1483917789918920714'
const servers: IsolatedServer[] = []
afterAll(async () => { for (const server of servers) await server.stop() })

async function getJson(server: IsolatedServer, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await realFetch(`${server.baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  return await res.json() as Record<string, unknown>
}

interface Report {
  checks: Array<{ checkId: string; latestExecution?: { outcome: string }; latestValidSnapshot?: { observations: Array<{ key: string; status: string; incident?: { key: string } }> } }>
}

/** The doctor's CACHED report (what the Health page shows) — the targeted reruns keep it current without a sweep (D8). */
async function cachedFindings(server: IsolatedServer): Promise<{ outcomes: Record<string, string>; incidents: string[] }> {
  return summarize(await getJson(server, '/api/plugins/health/doctor') as unknown as Report)
}

/** A FRESH full sweep. */
async function channelFindings(server: IsolatedServer): Promise<{ outcomes: Record<string, string>; incidents: string[] }> {
  return summarize(await getJson(server, '/api/plugins/health/doctor/run', { method: 'POST', body: '{}' }) as unknown as Report)
}

function summarize(report: Report): { outcomes: Record<string, string>; incidents: string[] } {
  const outcomes: Record<string, string> = {}
  const incidents: string[] = []
  for (const check of report.checks) {
    if (!/delivery-discord|channel-aliases|channel-approvals/.test(check.checkId)) continue
    outcomes[check.checkId] = check.latestExecution?.outcome ?? 'none'
    for (const observation of check.latestValidSnapshot?.observations ?? []) {
      if (observation.incident) incidents.push(observation.incident.key)
    }
  }
  return { outcomes, incidents }
}

function cliEnv(server: IsolatedServer, over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...server.env, BAKIN_URL: server.baseUrl, BAKIN_CONSOLE_FORMAT: 'silent', ...over }
}

describe('channel readiness agreement across API, tool, health, and CLI', () => {
  it('reproduction (Pi, enabled, guild, no token): every surface says missing_token; exactly one incident; no post attempted', async () => {
    const server = await startIsolatedServer({
      settings: { integrations: { discord: { enabled: true, guildIds: [GUILD], approvers: ['202168845362921483'] } } },
      env: { BAKIN_DELIVERY_TRANSPORT: 'fake' },
      unsetEnv: ['DISCORD_BOT_TOKEN'],
    })
    servers.push(server)

    // 1. API
    const readiness = await getJson(server, '/api/channels')
    expect((readiness.connection as { state: string }).state).toBe('missing_token')
    expect(readiness.owner).toBe('bridge')
    expect(readiness.token).toEqual({ present: false, source: null })
    expect((readiness.remediation as { action: string }).action).toBe('add_token')

    // 2. The post tool, through the exec-tools API — fails BEFORE any send.
    const post = await getJson(server, '/api/exec-tools/bakin_exec_post_channel', {
      method: 'POST',
      body: JSON.stringify({ params: { channel: `discord:channel:${GUILD}01`, content: 'hello' }, agent: 'cli' }),
    })
    expect(post.ok).toBe(false)
    expect(String(post.error)).toContain('bot token is missing')
    expect(String(post.error)).toContain('Settings → Channels')
    expect(String(post.error)).not.toContain('no channel layer')
    expect(post.kind).toBe('not_configured')

    // 3. Health: exactly ONE incident across the three channel checks.
    const findings = await channelFindings(server)
    expect(findings.incidents).toEqual(['missing-token'])
    expect(findings.outcomes['health.channel-aliases']).toBe('not_applicable')
    expect(findings.outcomes['health.channel-approvals']).toBe('not_applicable')

    // 4. Both CLI paths from SEPARATE processes with a DIFFERENT env: the CLI
    //    has a dummy token in ITS env and must still report the SERVER's truth.
    const env = cliEnv(server, { DISCORD_BOT_TOKEN: 'dummy-only-in-the-cli-env' })
    const check = await runCli(['check', 'channels', '--json'], env)
    expect(check.code).toBe(2)
    const checkJson = JSON.parse(check.stdout)
    expect(checkJson.status).toBe('warn')
    expect(checkJson.details).toMatchObject({ mode: 'server', via: 'http', state: 'missing_token' })
    expect(checkJson.message).not.toContain('no channel layer')

    const status = await runCli(['channels', 'status', '--json'], env)
    expect(status.code).toBe(2)
    expect(JSON.parse(status.stdout).connection.state).toBe('missing_token')

    await server.stop()
    servers.pop()
  }, 120_000)

  it('rejected token (fake reject-401): failed/auth_failed, one bridge-failed incident, reconnect exits 1', async () => {
    const server = await startIsolatedServer({
      settings: { integrations: { discord: { enabled: true, guildIds: [GUILD], approvers: ['202168845362921483'] } } },
      env: { BAKIN_DELIVERY_TRANSPORT: 'fake', BAKIN_DELIVERY_FAKE: 'reject-401' },
      unsetEnv: ['DISCORD_BOT_TOKEN'],
    })
    servers.push(server)
    const set = await getJson(server, '/api/secrets', { method: 'POST', body: JSON.stringify({ provider: 'discord', name: 'botToken', value: 'bogus-token-value' }) })
    expect(set.ok).toBe(true)
    await waitUntil(async () => ((await getJson(server, '/api/channels')).connection as { state: string }).state === 'failed', { label: 'bridge failed after the bogus token', timeoutMs: 30_000 })
    const readiness = await getJson(server, '/api/channels')
    expect((readiness.connection as { lastError: { kind: string } }).lastError.kind).toBe('auth_failed')
    expect(JSON.stringify(readiness)).not.toContain('bogus-token-value')

    // D8: the incident follows the transition within seconds — no sweep needed.
    await waitUntil(async () => JSON.stringify((await cachedFindings(server)).incidents) === JSON.stringify(['bridge-failed']), { label: 'bridge-failed incident in the cached report', timeoutMs: 15_000 })
    const findings = await channelFindings(server)
    expect(findings.incidents).toEqual(['bridge-failed'])
    expect(findings.outcomes['health.channel-aliases']).toBe('not_applicable')

    const reconnect = await runCli(['channels', 'reconnect', '--json'], cliEnv(server))
    expect(reconnect.code).toBe(1)
    expect(JSON.parse(reconnect.stdout).readiness.connection.state).toBe('failed')
    await server.stop()
    servers.pop()
  }, 120_000)

  it('ready bridge: connected, verify all-pass, zero channel incidents, check channels ok', async () => {
    const server = await startIsolatedServer({
      settings: {
        integrations: { discord: { enabled: true, guildIds: [GUILD], approvers: ['202168845362921483'] } },
        notifications: { channel: `discord:channel:${GUILD}01` },
      },
      env: { BAKIN_DELIVERY_TRANSPORT: 'fake', BAKIN_DELIVERY_FAKE: 'ready', DISCORD_BOT_TOKEN: 'fake-token-for-the-fake-transport' },
    })
    servers.push(server)
    await waitUntil(async () => ((await getJson(server, '/api/channels')).connection as { state: string }).state === 'connected', { label: 'connected on the fake transport', timeoutMs: 30_000 })
    const readiness = await getJson(server, '/api/channels')
    expect(readiness.token).toEqual({ present: true, source: 'env' })
    expect((readiness.channels as { items: unknown[] }).items).toHaveLength(2)
    expect((readiness.routing as { alertChannel: { resolved: string } }).alertChannel.resolved).toBe('ok')

    const verify = await getJson(server, '/api/channels/verify', { method: 'POST', body: '{}' }) as { items: Array<{ key: string; status: string }> }
    const failed = verify.items.filter((item) => item.status === 'fail')
    expect(failed).toEqual([])
    expect(verify.items.find((item) => item.key === 'gateway')?.status).toBe('pass')
    expect(verify.items.find((item) => item.key === `guild:${GUILD}`)?.status).toBe('pass')
    expect(verify.items.find((item) => item.key === 'health')?.status).toBe('pass')

    await waitUntil(async () => (await cachedFindings(server)).incidents.length === 0 && (await cachedFindings(server)).outcomes['health.channel-aliases'] === 'observed', { label: 'zero channel incidents in the cached report', timeoutMs: 15_000 })
    const findings = await channelFindings(server)
    expect(findings.incidents).toEqual([])
    expect(findings.outcomes['health.channel-aliases']).toBe('observed')

    const check = await runCli(['check', 'channels', '--json'], cliEnv(server, { DISCORD_BOT_TOKEN: undefined }))
    expect(check.code).toBe(0)
    expect(JSON.parse(check.stdout).details).toMatchObject({ mode: 'server', via: 'http', state: 'connected' })
    await server.stop()
    servers.pop()
  }, 120_000)
})
