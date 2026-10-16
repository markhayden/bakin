/**
 * Tests for the credentials onboarding component (LLM + channels).
 *
 * P2.2: the component reads through the runtime-neutral credentialStatus()
 * contract — credential-shape PARSING is adapter-owned and tested in
 * tests/adapter-openclaw/credential-status.test.ts. Here we verify:
 *   - ok/warn mapping from the reported provider/channel names
 *   - honest warn when credentialStatus throws
 *   - channels check reports ok-by-design on a channel-less runtime
 *   - install() for both subcomponents is a hard noop
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-onboarding-creds-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

let llmProviders: string[] = []
let channelNames: string[] = []
let statusThrows = false
let hasChannelLayer = true

const runtime = {
  get channels() {
    return hasChannelLayer ? { list: async () => [] } : undefined
  },
  credentialStatus: async () => {
    if (statusThrows) throw new Error('status boom')
    return { llmProviders, channels: channelNames }
  },
}

mock.module('../../../src/core/app-services', () => ({
  maybeGetAppServices: () => ({ runtime }),
  createAppServices: async () => ({ runtime }),
}))
mock.module('../../../src/core/app-services-store', () => ({
  maybeGetAppServices: () => ({ runtime }),
  createAppServices: async () => ({ runtime }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

let readinessStarted = false
let readinessSnapshot: ChannelReadiness | null = null
let fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null = null
mock.module('../../../src/core/delivery/readiness', () => ({
  isChannelReadinessStarted: () => readinessStarted,
  getChannelReadiness: () => {
    if (!readinessSnapshot) throw new Error('test did not set readinessSnapshot')
    return readinessSnapshot
  },
}))
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => (fetchImpl ? fetchImpl(input, init) : realFetch(input, init))) as typeof fetch

function snapshot(state: ChannelReadinessState, over: Partial<ChannelReadiness> = {}): ChannelReadiness {
  return {
    runtime: { adapter: 'pi', deliveryMode: 'unavailable' },
    owner: 'bridge',
    enabled: state !== 'disabled',
    token: { present: state !== 'missing_token', source: state !== 'missing_token' ? 'store' : null },
    guilds: [{ id: 'g1', joined: state === 'connected', channelCount: state === 'connected' ? 1 : null }],
    connection: { state, since: 'x', lastError: null },
    channels: { items: [], source: 'none', collectedAt: null },
    routing: {
      alertChannel: { setting: 'notifications.channel', value: null, resolved: 'unset' },
      approvalsChannel: { setting: 'approvals.channel', value: null, resolved: 'unset' },
      approvalsEnabled: false,
      aliases: [],
    },
    remediation: remediationForState(state, null),
    generatedAt: 'x',
    ...over,
  }
}

function writeSettings(body: Record<string, unknown>): void {
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'settings.json'), JSON.stringify(body))
  resetSettingsCache()
}

import { llmComponent, channelsComponent } from '../../../src/core/onboarding/credentials'
import { resetSettingsCache } from '../../../packages/core/src/settings'
import { setStoredSecret, unsetStoredSecret } from '../../../packages/core/src/media/secret-store'
import { remediationForState } from '../../../packages/core/src/delivery/copy'
import type { ChannelReadiness, ChannelReadinessState } from '../../../packages/core/src/delivery'

const opts = { interactive: false, autoApprove: true, json: false, checkOnly: false, force: false }

beforeEach(() => {
  llmProviders = []
  channelNames = []
  statusThrows = false
  hasChannelLayer = true
  readinessStarted = false
  readinessSnapshot = null
  fetchImpl = async () => { throw new Error('fetch failed: ECONNREFUSED') }
  delete process.env.DISCORD_BOT_TOKEN
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  unsetStoredSecret('discord', 'botToken')
  resetSettingsCache()
})

describe('llm.check()', () => {
  it('warns when no provider has usable credentials', async () => {
    const result = await llmComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('No LLM provider')
    expect(result.remediation).toContain('runtime adapter')
  })

  it('reports ok listing the configured providers', async () => {
    llmProviders = ['anthropic', 'openai-codex']
    const result = await llmComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('anthropic')
    expect(result.message).toContain('openai-codex')
    expect(result.details?.providers).toEqual(['anthropic', 'openai-codex'])
  })

  it('warns honestly when credentialStatus throws', async () => {
    statusThrows = true
    const result = await llmComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('Could not read')
  })
})

describe('llm.install()', () => {
  it('is a noop that returns the runtime docs URL', async () => {
    const result = await llmComponent.install(opts)
    expect(result.status).toBe('noop')
    expect(result.message).toContain('runtime adapter')
  })
})

describe('channels.check() — ONE readiness engine, two modes (#908)', () => {
  it('server mode in-process: projects the collector snapshot directly', async () => {
    readinessStarted = true
    readinessSnapshot = snapshot('connected', { channels: { items: [{ id: 'discord:channel:1', platform: 'discord', label: '#general', capabilities: ['message'] }], source: 'bridge', collectedAt: 'x' } })
    const result = await channelsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('Discord bridge connected')
    expect(result.details).toMatchObject({ mode: 'server', via: 'in-process', state: 'connected', channels: ['discord:channel:1'] })
  })

  it('server mode in-process: a configuration gap warns with the copy-table remediation and the tab href', async () => {
    readinessStarted = true
    readinessSnapshot = snapshot('missing_token')
    const result = await channelsComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('bot token is missing')
    expect(result.remediation).toContain('/settings?tab=channels')
    expect(result.details).toMatchObject({ mode: 'server', state: 'missing_token' })
  })

  it('server mode over HTTP: a CLI process asks a reachable server and reports ITS truth', async () => {
    readinessStarted = false
    fetchImpl = async () => ({ ok: true, json: async () => snapshot('connected') }) as Response
    const result = await channelsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.details).toMatchObject({ mode: 'server', via: 'http', state: 'connected' })
  })

  it('native runtime is ok in server mode and never says "no channel layer"', async () => {
    readinessStarted = true
    readinessSnapshot = snapshot('native', { runtime: { adapter: 'openclaw', deliveryMode: 'native' }, owner: 'runtime', channels: { items: [{ id: 'discord', platform: 'discord', label: 'Discord', capabilities: ['message'] }], source: 'runtime', collectedAt: 'x' } })
    const result = await channelsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('owns channel delivery')
    expect(result.message).not.toContain('no channel layer')
  })

  it('configuration-only mode (no server): says so, projects settings + the local slot, never claims connected', async () => {
    readinessStarted = false
    fetchImpl = async () => { throw new Error('fetch failed: ECONNREFUSED') }
    writeSettings({ runtime: { adapter: 'pi' }, integrations: { discord: { enabled: true, guildIds: ['g1'] } } })
    const missing = await channelsComponent.check()
    expect(missing.status).toBe('warn')
    expect(missing.message).toContain('Server not running — configuration only')
    expect(missing.message).toContain('server-side environment token is not visible')
    expect(missing.details).toMatchObject({ mode: 'configuration-only', projected: 'missing_token' })
    expect(missing.message).not.toContain('no channel layer')

    setStoredSecret('discord', 'botToken', 'tok')
    const ready = await channelsComponent.check()
    expect(ready.status).toBe('ok')
    expect(ready.details).toMatchObject({ mode: 'configuration-only', projected: 'ready_to_connect' })
    expect(ready.message).not.toContain('connected')

    writeSettings({ runtime: { adapter: 'openclaw' }, integrations: { discord: { enabled: true, guildIds: [] } } })
    channelNames = ['discord']
    const native = await channelsComponent.check()
    expect(native.status).toBe('ok')
    expect(native.details).toMatchObject({ projected: 'native', channels: ['discord'] })
  })

  it('configuration-only mode on a native runtime still reads the runtime-owned channel config', async () => {
    readinessStarted = false
    writeSettings({ runtime: { adapter: 'openclaw' }, integrations: { discord: { enabled: false, guildIds: [] } } })

    channelNames = []
    const none = await channelsComponent.check()
    expect(none.status).toBe('warn')
    expect(none.message).toContain('No messaging channel')
    expect(none.message).toContain('configuration only')
    expect(none.details).toMatchObject({ mode: 'configuration-only', projected: 'native', channels: [] })

    statusThrows = true
    const broken = await channelsComponent.check()
    expect(broken.status).toBe('warn')
    expect(broken.message).toContain('status boom')
    expect(broken.details).toMatchObject({ mode: 'configuration-only', projected: 'native' })
  })
})

describe('channels.install()', () => {
  it('is a noop that returns the runtime docs URL', async () => {
    const result = await channelsComponent.install(opts)
    expect(result.status).toBe('noop')
    expect(result.message).toContain('runtime adapter')
  })
})
