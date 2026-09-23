import '@makinbakin/sdk/styles.css'

import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { SpendPage } from '../components/spend-page'

// Deterministic Overview: a metered month with an open cap incident and a
// budget rule, so tiles, the pace line, the trend, utilization, the
// breakdown and the incident banner all render from one payload.
const T0 = Date.UTC(2026, 8, 22, 12, 0, 0)
const lanes = { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0, unpricedMeteredTokens: 0 }
const scope = (metered: number, sub = 0) => ({ ...lanes, meteredUsdMicros: metered, meteredTokens: metered / 10, subscriptionTokens: sub, unattributed: { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0 } })
const window = (startMs: number, metered: number, sub: number) => ({
  startMs,
  global: scope(metered, sub),
  byAgent: { pixel: scope(metered * 0.6), rolo: scope(metered * 0.4, sub) },
  byProvider: { anthropic: { ...lanes, meteredUsdMicros: metered, meteredTokens: metered / 10 }, 'openai-codex': { ...lanes, subscriptionTokens: sub } },
  byModel: { 'anthropic/claude-sonnet-4-6': { ...lanes, meteredUsdMicros: metered, meteredTokens: metered / 10 } },
  byWorkClass: {},
})

const spend = {
  window: '24h', estimated: true, totalUsdMicros: 4_250_000,
  byAgent: [{ agent: 'pixel', costUsdMicros: 2_550_000, runs: 8 }, { agent: 'rolo', costUsdMicros: 1_700_000, runs: 5 }],
  byModel: [{ model: 'anthropic/claude-sonnet-4-6', costUsdMicros: 4_250_000, runs: 13 }],
  byWorkClass: [{ workClass: 'workflow', runs: 8, totalTokens: 48_000, costUsdMicros: 2_550_000, subscriptionTokens: 0, avgCostUsdMicros: 318_750 }],
  timeline: Array.from({ length: 6 }, (_, i) => ({ startMs: T0 - (6 - i) * 4 * 3_600_000, endMs: T0 - (5 - i) * 4 * 3_600_000, costUsdMicros: 500_000 + i * 250_000, subscriptionTokens: 4_000 * (i + 1), unpricedMeteredTokens: 0 })),
  facets: { computedAt: T0, daily: window(T0 - 12 * 3_600_000, 4_250_000, 24_000), monthly: window(T0 - 21 * 86_400_000, 91_000_000, 180_000) },
  pace: { daily: { meteredUsdMicros: 8_500_000, subscriptionTokens: 48_000, endsMs: T0 + 12 * 3_600_000 }, monthly: { meteredUsdMicros: 124_000_000, subscriptionTokens: 250_000, endsMs: T0 + 8 * 86_400_000 } },
  observedDays: { month: 19, daysIntoMonth: 22 },
}
const rules = [{ id: 'rule-global', scope: 'global', lane: 'metered', monthlyCap: 100, atCap: 'defer' }]
const incidents = [{
  id: 7, eventId: 'evt-7-1', episode: 1, scope: 'agent', scopeId: 'pixel', lane: 'metered', window: 'daily', windowStartMs: T0 - 12 * 3_600_000,
  kind: 'cap', unit: 'usd_micros', capValue: 2_000_000, spentValue: 2_550_000, atCap: 'defer', openedAt: T0 - 3_600_000, status: 'open', resolvedAt: null, resolution: null, notifiedAt: T0,
}]
const status = {
  paused: false, configured: true, perAgent: { pixel: 'deferred', rolo: 'ok' }, perTask: {},
  billing: { pixel: { provider: 'anthropic', lane: 'metered', laneSource: 'detected', model: 'anthropic/claude-sonnet-4-6' }, rolo: { provider: 'openai-codex', lane: 'subscription', laneSource: 'detected', model: 'openai-codex/gpt-5.6-luna' } },
  overrides: [], deferredProviders: [], openIncidents: incidents,
  milestones: [{ id: 3, ruleId: 'rule-global', window: 'monthly', windowStartMs: T0 - 21 * 86_400_000, milestone: 90, spentValue: 91_000_000, capValue: 100_000_000, unit: 'usd_micros', crossedAt: T0, coveredBy: null, eventId: 'evt-m3', notifiedAt: T0, acknowledgedAt: null }],
}

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost
    fixture={{
      ...DEFAULT_PLUGIN_UI_FIXTURE,
      route: '/spend',
      randomSeed: 'spend-overview',
      network: [
        { path: '/api/plugins/spend/spend?window=24h', status: 200, json: spend },
        { path: '/api/plugins/spend/limits', status: 200, json: { rules } },
        { path: '/api/plugins/spend/incidents', status: 200, json: { incidents } },
        { path: '/api/plugins/spend/status', status: 200, json: status },
        { path: '/api/plugins/models/available', status: 200, json: { models: [{ id: 'anthropic/claude-sonnet-4-6', provider: 'anthropic' }, { id: 'openai-codex/gpt-5.6-luna', provider: 'openai-codex' }] } },
      ],
    }}
    registrations={[{ id: 'spend', routes: { '/spend': SpendPage } }]}
  />,
)
