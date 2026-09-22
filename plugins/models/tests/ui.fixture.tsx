import '@makinbakin/sdk/styles.css'

import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { ModelsPage } from '../components/models-page'

// Deterministic Advanced view: a Codex-subscription box with one metered
// provider, a dead agent pin with a proposal, one pending adapter write,
// fallbacks/aliases/subagent default supported, and a recommended plan
// that differs — so the mode switch, every section, callouts, chips, the
// catalog disclosure and the recommendation surfaces all render from one
// payload.
const LUNA = 'openai-codex/gpt-5.6-luna'
const TERRA = 'openai-codex/gpt-5.6-terra'
const MINI = 'openai-codex/gpt-5.4-mini'
const HAIKU = 'anthropic/claude-haiku-4-5'
const DEAD = 'openai/gpt-6-astra'

const ok = { status: 'eligible', detail: 'openai-codex has credentials' }
const state = (ref: string, model: string | null, document: string, label: string, extra: Record<string, unknown> = {}) => ({
  ref, model, document, label, ...(model && ref !== 'ui:mode' ? { eligibility: model === DEAD ? { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' } : ok } : {}), ...extra,
})
const states = [
  state('policy:defaultModel', LUNA, 'policy', 'Default model'),
  state('policy:defaultSubagentModel', MINI, 'policy', 'Default subagent model'),
  state('policy:fallback:0', TERRA, 'policy', 'Fallback 1'),
  state('policy:alias:fast', MINI, 'policy', 'Alias fast'),
  state('agent:main:model', null, 'agent:main', 'Main'),
  state('agent:main:subagentModel', null, 'agent:main', 'Main subagents'),
  state('agent:pixel:model', DEAD, 'agent:pixel', 'Pixel'),
  state('agent:pixel:subagentModel', null, 'agent:pixel', 'Pixel subagents'),
  ...['scheduled', 'workflow', 'adhoc', 'recovery', 'decomposition', 'send'].map((c) => state(`route:${c}`, c === 'workflow' ? TERRA : null, 'routing', c, c === 'workflow' ? { thinking: 'high' } : {})),
  ...['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping'].map((c) => state(`route:${c}`, c === 'relay' ? HAIKU : MINI, 'routing', c)),
  state('tag:heavy', LUNA, 'routing', 'heavy'),
  state('ui:mode', 'advanced', 'routing', 'Models page mode'),
]
const selections = {
  revision: 'rev-fixture',
  support: { defaultModel: true, fallbackModels: true, defaultSubagentModel: true, aliases: true, perAgentSubagentModel: true, supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'], perTurnModel: true },
  states,
  proposals: [{ ref: 'agent:pixel:model', from: DEAD, to: LUNA, reason: 'no credentials for openai', source: 'recommender', revision: 'rev-fixture' }],
  pending: [{ document: 'routing', refs: ['route:relay'], intended: { 'route:relay': HAIKU }, state: 'unsettled', startedAt: Date.now() - 4_000 }],
  evidence: { catalog: 'ok', runtimeAvailability: 'ok', credentials: 'ok', rejections: 'ok' },
}
const plan = {
  revision: 'rev-fixture',
  current: { agent: LUNA, chores: { model: null, models: [MINI, HAIKU], mixed: true }, enrichmentEnabled: true },
  recommended: {
    agent: { model: LUNA, why: 'Your current default model — it can run here.', suitability: 'known' },
    chores: { model: TERRA, why: 'included in your plan · lightest tier that can do these jobs', suitability: 'known' },
    routes: ['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping'].map((workClass) => ({ workClass, model: TERRA, reason: 'included in your plan · lightest tier that can do these jobs' })),
    enrichment: 'chores',
    ops: ['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping'].map((workClass) => ({ ref: `route:${workClass}`, set: { model: TERRA } })),
    notes: [],
  },
  routeProposals: { proposals: [], skipped: [] },
  candidates: 4,
}
const row = (id: string, name: string, provider: string, tier: string, extra: Record<string, unknown> = {}) => ({
  id, name, provider, tier, available: true, configured: true, tags: ['configured'], contextWindow: 200_000, eligibility: ok, ...extra,
})
const models = [
  row(LUNA, 'GPT-5.6 Luna', 'openai-codex', 'premium', { isDefault: true, input: 'text,image', contextWindow: 400_000, description: 'Frontier reasoning for agent work.' }),
  row(TERRA, 'GPT-5.6 Terra', 'openai-codex', 'standard', { input: 'text,image', contextWindow: 400_000, fallbackIndex: 0 }),
  row(MINI, 'GPT-5.4 Mini', 'openai-codex', 'budget', { input: 'text' }),
  row(HAIKU, 'Claude Haiku 4.5', 'anthropic', 'budget', { costRange: '$1 in / $5 out per 1M', contextWindowDisplay: '200K' }),
  row(DEAD, 'GPT-6 Astra', 'openai', 'premium', { available: false, configured: false, tags: [], unavailableReason: 'no_credentials', eligibility: { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' } }),
]

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost
    fixture={{
      ...DEFAULT_PLUGIN_UI_FIXTURE,
      route: '/models',
      randomSeed: 'models-advanced',
      network: [
        { path: '/api/plugins/models/selections', status: 200, json: selections },
        { path: '/api/plugins/models/plan', status: 200, json: plan },
        { path: '/api/plugins/models/available', status: 200, json: { models, cached: true, cachedAt: Date.now() - 120_000, stale: false } },
        { path: '/api/plugins/models/runtime/status', status: 200, json: { pending: false, advice: { needed: false } } },
      ],
    }}
    registrations={[{ id: 'models', routes: { '/models': ModelsPage } }]}
  />,
)
