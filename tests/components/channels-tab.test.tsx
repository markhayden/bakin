// @vitest-environment jsdom

/**
 * Settings → Channels (#908 T10): every readiness state renders from the
 * ONE snapshot, the recovery flow (missing token → set → connecting →
 * connected) drives the Banner, Reconnect/Verify carry busy + disabled
 * states and never send, the ID editors accept never-seen ids, the routing
 * form saves with replace semantics, and `?field=` focuses the owning
 * control.
 */
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../rtl-settle'
import { actRender } from '../rtl-settle'
import { ChannelsTab, fieldIdFor, type ChannelReadinessPayload } from '../../src/components/channels-tab'
import { emitPluginEvent } from '../../src/hooks/use-plugin-event'
import { waitUntil } from '../helpers/wait'

type State = ChannelReadinessPayload['connection']['state']

function snapshot(state: State, over: Partial<ChannelReadinessPayload> = {}): ChannelReadinessPayload {
  const connected = state === 'connected' || state === 'degraded'
  const lastError = state === 'failed' ? { kind: 'auth_failed', message: 'Discord rejected the bot token (401)', at: 'x' } : null
  const remediation = state === 'native' || state === 'connected' ? null : {
    summary: `Readiness is ${state}.`,
    nextStep: 'Do the thing in Settings → Channels.',
    href: '/settings?tab=channels',
    action: state === 'missing_token' ? 'add_token' : state === 'missing_guild' ? 'add_guild' : state === 'disabled' ? 'enable' : state === 'connecting' ? 'wait' : state === 'failed' ? 'replace_token' : 'reconnect',
  }
  return {
    runtime: { adapter: state === 'native' ? 'openclaw' : 'pi', deliveryMode: state === 'native' ? 'native' : 'unavailable' },
    owner: state === 'native' ? 'runtime' : 'bridge',
    enabled: state !== 'disabled',
    token: { present: state !== 'missing_token', source: state === 'missing_token' ? null : 'store' },
    guilds: state === 'missing_guild' ? [] : [{ id: '1483917789918920714', name: 'Made In Wyo', joined: connected ? state === 'connected' : null, channelCount: state === 'connected' ? 2 : null }],
    connection: { state, since: '2026-10-06T00:00:00.000Z', lastError, ...(connected ? { botUser: { id: 'bot', name: 'Margo' } } : {}) },
    channels: connected || state === 'native'
      ? { items: [{ id: 'discord:channel:1', platform: 'discord', label: '#general', capabilities: ['message', 'interactive-approval'] }, { id: 'discord:channel:2', platform: 'discord', label: `#${'x'.repeat(78)}`, capabilities: ['message'] }], source: state === 'native' ? 'runtime' : 'bridge', collectedAt: 'x' }
      : { items: [], source: 'none', collectedAt: null },
    routing: {
      alertChannel: { setting: 'notifications.channel', value: 'discord:channel:1', resolved: connected ? 'ok' : 'unverifiable', channelId: 'discord:channel:1' },
      approvalsChannel: { setting: 'approvals.channel', value: null, resolved: 'unset' },
      approvalsEnabled: false,
      aliases: [{ setting: 'notifications.channelAliases.alerts', value: 'discord:channel:2', resolved: connected ? 'ok' : 'unverifiable', channelId: 'discord:channel:2' }],
    },
    remediation,
    generatedAt: 'x',
    ...over,
  }
}

const settings = { integrations: { discord: { enabled: true, guildIds: ['1483917789918920714'], approvers: ['202168845362921483'], inbound: { enabled: false, agentId: 'main', requireMention: true, allowFrom: [] } } } }
const slot = { provider: 'discord', name: 'botToken', label: 'Discord bot token', description: 'Bot token.', envVar: 'DISCORD_BOT_TOKEN', injectEnv: false, owner: { label: 'Settings → Channels', href: '/settings?tab=channels' }, status: { present: false, source: null } }

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

function mockFetch(readiness: ChannelReadinessPayload, handlers: Partial<Record<string, (init?: RequestInit) => Response | Promise<Response>>> = {}) {
  let current = readiness
  const calls: Array<{ url: string; method: string; body?: unknown }> = []
  const spy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    const key = `${method} ${url.split('?')[0]}`
    if (handlers[key]) return handlers[key]!(init)
    if (key === 'GET /api/channels') return json(current)
    if (key === 'GET /api/settings') return json(settings)
    if (key === 'GET /api/secrets') return json({ stored: [], secrets: {}, slots: [{ ...slot, status: current.token }] })
    if (key === 'POST /api/channels/reconnect') { current = snapshot('connecting'); return json({ readiness: current }, 202) }
    if (key === 'POST /api/channels/verify') return json({ items: [{ key: 'gateway', status: 'pass', summary: 'Gateway connected as Margo.' }, { key: 'routing:approvals.channel', status: 'skipped', summary: 'Approval alerts are disabled.', setting: 'approvals.channel' }], readiness: current })
    if (key === 'PUT /api/channels/routing') return json({ ok: true, readiness: current })
    if (key === 'POST /api/settings') return json({ ok: true })
    if (key === 'POST /api/secrets') { current = snapshot('connecting'); return json({ ok: true }) }
    if (key === 'DELETE /api/secrets') return json({ ok: true })
    return json({})
  }) as typeof fetch)
  return { spy, calls, setCurrent: (next: ChannelReadinessPayload) => { current = next } }
}

afterEach(() => { mock.restore() })

const STATES: State[] = ['native', 'disabled', 'missing_token', 'missing_guild', 'connecting', 'connected', 'degraded', 'disconnected', 'failed']

describe('ChannelsTab', () => {
  describe('state matrix', () => {
    for (const state of STATES) {
      it(`renders ${state} from the snapshot`, async () => {
        mockFetch(snapshot(state))
        await actRender(() => render(<ChannelsTab />))
        const tab = await screen.findByTestId('channels-tab')
        expect(tab.getAttribute('data-state')).toBe(state)
        expect(screen.getByTestId('channels-state').textContent).toBeTruthy()
        if (state === 'native') {
          expect(screen.getByText(/owns channel delivery with its own bot and token/)).toBeTruthy()
          expect(screen.queryByRole('status')).toBeNull()
          expect(screen.getByRole('button', { name: 'Reconnect the Discord bridge' }).hasAttribute('disabled')).toBe(true)
        } else if (state === 'connected') {
          expect(screen.queryByText(/Readiness is/)).toBeNull()
          expect(screen.getByText('Margo (bot)')).toBeTruthy()
        } else {
          expect(screen.getByText(`Readiness is ${state}.`)).toBeTruthy()
        }
        if (state === 'failed') expect(screen.getByText(/Last error: auth_failed/)).toBeTruthy()
        if (state === 'missing_token') expect(screen.getAllByText('Not set').length).toBeGreaterThan(0)
      })
    }
  })

  it('shows loading then an honest error state with retry when the snapshot cannot be read', async () => {
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response)
    await actRender(() => render(<ChannelsTab />))
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByTestId('channels-tab')).toBeNull()
    spy.mockResolvedValue(json(snapshot('connected')))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(await screen.findByTestId('channels-tab')).toBeTruthy()
  })

  it('recovery flow: missing token → set the token → reconnecting → connected clears the Banner', async () => {
    const { calls, setCurrent } = mockFetch(snapshot('missing_token'))
    await actRender(() => render(<ChannelsTab />))
    await screen.findByText('Readiness is missing_token.')
    fireEvent.change(screen.getByLabelText('Discord bot token value'), { target: { value: 'tok-new' } })
    await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'Set Discord bot token' })) })
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/secrets')?.body).toEqual({ provider: 'discord', name: 'botToken', value: 'tok-new' })
    expect(await screen.findByText('Reconnecting…')).toBeTruthy()
    // The server settles and pushes `channels.readiness`; the tab refetches.
    setCurrent(snapshot('connected'))
    await act(async () => { emitPluginEvent({ event: 'channels.readiness' }) })
    await waitUntil(() => screen.getByTestId('channels-tab').getAttribute('data-state') === 'connected', { label: 'connected after the push' })
    expect(screen.getByText('Margo (bot)')).toBeTruthy()
    expect(screen.queryByText(/Readiness is/)).toBeNull()
    expect(screen.queryByText('Reconnecting…')).toBeNull()
  })

  it('Reconnect POSTs, flips to connecting, and stays disabled while the bridge settles', async () => {
    const { calls } = mockFetch(snapshot('disconnected'))
    await actRender(() => render(<ChannelsTab />))
    await screen.findByTestId('channels-tab')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reconnect the Discord bridge' })) })
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/channels/reconnect')).toBe(true)
    expect(screen.getByTestId('channels-tab').getAttribute('data-state')).toBe('connecting')
    expect(screen.getByRole('button', { name: 'Reconnect the Discord bridge' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Verify channel delivery' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Reconnecting…')).toBeTruthy()
  })

  it('Verify POSTs the read-only probe and renders pass/skipped rows with links to the owning field', async () => {
    const { calls } = mockFetch(snapshot('connected'))
    await actRender(() => render(<ChannelsTab />))
    await screen.findByTestId('channels-tab')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify channel delivery' })) })
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/api/channels/verify'])
    const results = await screen.findByTestId('channels-verify-results')
    expect(within(results).getByText('Gateway connected as Margo.')).toBeTruthy()
    expect(within(results).getByText('SKIPPED')).toBeTruthy()
    expect(within(results).getByRole('link', { name: 'Open approvals.channel' }).getAttribute('href')).toBe('/settings?tab=channels&field=approvals.channel')
  })

  it('ID editors accept never-seen ids, remove rows, and the save posts the whole Discord block', async () => {
    const { calls } = mockFetch(snapshot('connected'))
    await actRender(() => render(<ChannelsTab />))
    await screen.findByRole('form', { name: 'Discord bridge settings' })
    fireEvent.change(screen.getByLabelText('Server IDs to add'), { target: { value: '  9999999999999999999 ' } })
    // Enter adds and is swallowed by the entry (never submits the outer form).
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Server IDs to add'), { key: 'Enter' }) })
    expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/settings')).toHaveLength(0)
    expect(within(screen.getByRole('list', { name: 'Server IDs' })).getByText('9999999999999999999')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove 1483917789918920714' }))
    await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'Discord bridge settings' })) })
    const save = calls.find((c) => c.method === 'POST' && c.url === '/api/settings')
    expect(save?.body).toEqual({ integrations: { discord: { ...settings.integrations.discord, guildIds: ['9999999999999999999'] } } })
    expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/settings')).toHaveLength(1)
  })

  it('routing saves with replace semantics: a removed alias is absent from the PUT body', async () => {
    // No channel list ⇒ the free-text fallback renders, which fireEvent can drive.
    const { calls } = mockFetch(snapshot('connected', { channels: { items: [], source: 'bridge', collectedAt: 'x' } }))
    await actRender(() => render(<ChannelsTab />))
    await screen.findByRole('form', { name: 'Channel routing' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove alias alerts' }))
    fireEvent.change(screen.getByLabelText('New alias'), { target: { value: 'Daily' } })
    fireEvent.change(screen.getByLabelText('Channel', { selector: '#channels-field-aliases-target' }), { target: { value: 'discord:channel:1' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add alias' })) })
    await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'Channel routing' })) })
    const put = calls.find((c) => c.method === 'PUT' && c.url === '/api/channels/routing')
    expect(put?.body).toEqual({ alertChannel: 'discord:channel:1', approvalsEnabled: false, approvalsChannel: null, aliases: { daily: 'discord:channel:1' } })
  })

  it('?field= focuses the owning control', async () => {
    mockFetch(snapshot('missing_guild'))
    await actRender(() => render(<ChannelsTab highlightKey="integrations.discord.guildIds" />))
    await screen.findByRole('form', { name: 'Discord bridge settings' })
    // The focus retry fires on a timer; keep the act scope open while it lands.
    await act(async () => {
      await waitUntil(() => document.activeElement?.id === fieldIdFor('integrations.discord.guildIds'), { label: 'deep-linked field focused' })
    })
    expect(fieldIdFor('notifications.channelAliases.alerts')).toBe('channels-field-aliases')
    expect(fieldIdFor('nope')).toBeNull()
  })

  it('long identifiers keep their full value and never leak a token', async () => {
    mockFetch(snapshot('connected', { token: { present: true, source: 'env' } }))
    await actRender(() => render(<ChannelsTab />))
    const tab = await screen.findByTestId('channels-tab')
    expect(within(tab).getAllByRole('button', { name: 'Copy discord:channel:2' }).length).toBeGreaterThan(0)
    expect(tab.textContent).toContain(`#${'x'.repeat(78)}`)
    expect(tab.textContent).not.toContain('tok-')
    expect(screen.getByText('Environment variable')).toBeTruthy()
    expect(screen.getByText(/set by DISCORD_BOT_TOKEN/)).toBeTruthy()
  })
})
