import '@makinbakin/sdk/styles.css'

import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { ChannelsTab } from '../../../src/components/channels-tab'

/**
 * Browser fixture for Settings → Channels (#908 T10): the `degraded` state
 * with a long server name, snowflake ids, and an 80-character channel label,
 * so the conformance runner's overflow / axe / keyboard passes exercise the
 * narrow layout and long identifiers. Deterministic network; nothing is sent.
 */
const LONG_LABEL = `#${'release-announcements-and-runtime-roundup-digest-for-the-whole-team'.padEnd(79, '-')}`
const readiness = {
  runtime: { adapter: 'pi', deliveryMode: 'shimmed' },
  owner: 'bridge',
  enabled: true,
  token: { present: true, source: 'store' },
  guilds: [
    { id: '1483917789918920714', name: 'Made In Wyoming Collective Workspace Server', joined: true, channelCount: 2 },
    { id: '9999999999999999999', joined: false, channelCount: null, error: { kind: 'forbidden', message: 'Missing Access', at: '2026-10-06T00:00:00.000Z' } },
  ],
  connection: { state: 'degraded', since: '2026-10-06T00:00:00.000Z', lastError: null, botUser: { id: '1484001234567890123', name: 'Margo' } },
  channels: {
    items: [
      { id: 'discord:channel:1484017991346683915', platform: 'discord', label: '#general', capabilities: ['message', 'interactive-approval'] },
      { id: 'discord:channel:1512549735603376168', platform: 'discord', label: LONG_LABEL, capabilities: ['message'] },
    ],
    source: 'bridge',
    collectedAt: '2026-10-06T00:00:00.000Z',
  },
  routing: {
    alertChannel: { setting: 'notifications.channel', value: 'discord:channel:1484017991346683915', resolved: 'ok', channelId: 'discord:channel:1484017991346683915' },
    approvalsChannel: { setting: 'approvals.channel', value: 'alerts', resolved: 'unknown_channel' },
    approvalsEnabled: true,
    aliases: [{ setting: 'notifications.channelAliases.alerts', value: 'discord:channel:1512549735603376168', resolved: 'ok', channelId: 'discord:channel:1512549735603376168' }],
  },
  remediation: {
    summary: 'Discord bridge is connected, but not every configured server is reachable.',
    nextStep: 'Check the server list in Settings → Channels: invite the bot to the missing server or remove its ID.',
    href: '/settings?tab=channels',
    action: 'add_guild',
  },
  generatedAt: '2026-10-06T00:00:00.000Z',
}
const settings = {
  integrations: {
    discord: {
      enabled: true,
      guildIds: ['1483917789918920714', '9999999999999999999'],
      approvers: ['202168845362921483'],
      inbound: { enabled: true, agentId: 'main', requireMention: true, allowFrom: ['202168845362921483'] },
    },
  },
}
const secrets = {
  stored: [],
  secrets: { discord: ['botToken'] },
  slots: [{
    provider: 'discord', name: 'botToken', label: 'Discord bot token', description: 'Bot token for the Bakin delivery bridge.',
    envVar: 'DISCORD_BOT_TOKEN', injectEnv: false, owner: { label: 'Settings → Channels', href: '/settings?tab=channels' },
    status: { present: true, source: 'store' },
  }],
}

/** The same frame the /settings route renders the tab inside: page h1, category h2, one PageBody region. */
function ChannelsFixturePage() {
  return (
    <Page>
      <PageHeader title="Settings" description="Configure plugin behavior" />
      <PageBody labelledBy="active-settings-heading" gap="content" className="min-w-0">
        <h2 id="active-settings-heading">Channels</h2>
        <ChannelsTab />
      </PageBody>
    </Page>
  )
}

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost
    fixture={{
      ...DEFAULT_PLUGIN_UI_FIXTURE,
      route: '/settings-channels',
      randomSeed: 'channels-tab-degraded',
      network: [
        { path: '/api/channels', status: 200, json: readiness },
        { path: '/api/settings', status: 200, json: settings },
        { path: '/api/secrets', status: 200, json: secrets },
      ],
    }}
    registrations={[{ id: 'host-channels', routes: { '/settings-channels': ChannelsFixturePage } }]}
  />,
)
