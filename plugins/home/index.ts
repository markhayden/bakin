/**
 * Home plugin — server entry point.
 * The page Bakin opens on. What it shows is derived from the home's real
 * state; the only things stored are decisions a person made.
 * Deep reference: `.claude/knowledge/home.md`.
 */
import { z } from 'zod'
import type { BakinPlugin } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../src/core/logger'
import { installableComponent } from '../../src/core/onboarding/index'
import { componentInstallOperation } from '../../src/core/onboarding/operation'
import { getOperationRegistry } from '../../src/core/operations'
import { getSetupChecklist } from '../../src/core/onboarding/setup-checklist'
import { getRuntimeAdapterSupport } from '../../src/core/runtime-adapter-factory'
import { getSettings } from '../../src/core/settings'
import { setOperatorName } from '../../src/core/team-context'
import { HOME_CONTENT, TOUR_ICONS } from './lib/content'
import { introductionAnswersSchema, updateDecisions } from './lib/decisions'
import { completeIntroduction, recordHello, skipIntroduction, UnknownPersonalityError } from './lib/introduction'
import { gatherHomeFacts } from './lib/readiness'
import { availableStarters, homeState, offersHello, type HomeFacts } from './lib/state'
import { MAX_SHOWN, suggestionsFor, type SuggestionFacts } from './lib/suggestions'
import type { HomeStateResponse, HomeSuggestion, HomeTourResponse } from './types'

const log = createLogger('home')

const agentShape = z.object({ id: z.string(), name: z.string() })
const stateResponse = z.object({
  ok: z.literal(true),
  state: z.discriminatedUnion('name', [
    z.object({ name: z.literal('unavailable'), reason: z.enum(['runtime_unreachable', 'model_cannot_run']), detail: z.string().optional(), href: z.string() }),
    z.object({ name: z.literal('meet-agent'), agent: agentShape, resume: introductionAnswersSchema.optional() }),
    z.object({ name: z.literal('needs-login'), agent: agentShape }),
    z.object({ name: z.literal('ready'), agent: agentShape }),
  ]),
  starters: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    prompt: z.string(),
    needsAttachment: z.boolean(),
  })),
  personalities: z.array(z.object({ id: z.string(), label: z.string(), sample: z.string() })),
  hello: z.boolean(),
  introductionSkipped: z.boolean(),
  login: z.object({ runtime: z.string(), steps: z.array(z.string()), command: z.string().optional(), docsUrl: z.string() }).optional(),
  suggestions: z.array(z.object({ id: z.string(), title: z.string(), payoff: z.string(), action: z.object({ label: z.string(), href: z.string() }) })),
  suggestionCount: z.number(),
})

/** Setup checklist items with something to do, from the engines the checklist already asks. */
async function checklistTodo(): Promise<SuggestionFacts['checklistTodo']> {
  try {
    return (await getSetupChecklist()).items.filter((item) => item.state === 'todo').map((item) => item.id)
  } catch (err) {
    log.debug('Could not read the setup checklist', { error: String(err) })
    return 'unknown'
  }
}

/** The plugins that are loaded. Required lazily: the registry's import graph is the whole server. */
function loadedPlugins(): SuggestionFacts['plugins'] {
  try {
    const { pluginRegistry } = require('../../src/core/plugin-registry') as typeof import('../../src/core/plugin-registry')
    return pluginRegistry.getPluginIds()
  } catch (err) {
    log.debug('Could not read the loaded plugins', { error: String(err) })
    return 'unknown'
  }
}

/** Every suggestion that applies to this home now, in curated order. */
async function applicableSuggestions(facts: HomeFacts): Promise<HomeSuggestion[]> {
  const suggestionFacts: SuggestionFacts = {
    capabilities: facts.capabilities,
    imageProvider: facts.imageProvider,
    agents: facts.starters.agents,
    plugins: loadedPlugins(),
    checklistTodo: await checklistTodo(),
  }
  return suggestionsFor(HOME_CONTENT.suggestions, suggestionFacts, facts.decisions.dismissedSuggestions ?? {}, Date.now())
    .map(({ id, title, payoff, action }) => ({ id, title, payoff, action }))
}

/** The active runtime's own way to log a provider in. Bakin shows it; the person does it. */
function loginFor(): NonNullable<HomeStateResponse['login']> {
  const support = getRuntimeAdapterSupport(getSettings().runtime.adapter)
  return {
    runtime: support.label,
    steps: [...support.loginSteps],
    ...(support.loginCommand ? { command: support.loginCommand } : {}),
    docsUrl: support.docsUrl,
  }
}

const okResponse = z.object({ ok: z.literal(true) })
const introductionFailed = z.object({ ok: z.literal(false), step: z.enum(['identity', 'person', 'sync']), error: z.string() })
const errorResponse = z.object({ ok: z.literal(false), error: z.string() })

/**
 * Bring every agent's instructions up to date after the person's name
 * changed, as the same local sync operation onboarding and Health run
 * (it owns install-state and fetches nothing). Rejects when it failed.
 */
async function syncAgents(): Promise<void> {
  const registry = getOperationRegistry()
  const { operationId } = await registry.start(componentInstallOperation(installableComponent('agent-sync'), { autoApprove: true, allowServiceClaim: false }, 'web'))
  const view = await registry.await(operationId)
  if (view.status !== 'succeeded') throw new Error(view.outcome?.message ?? 'The agent sync did not finish')
}

const routes = [
  defineRoute({
    path: '/state',
    method: 'GET',
    summary: 'What Home shows now',
    description:
      'The Home state (unavailable, meet-agent, needs-login or ready), the starters this home can run and, once it is ready, the first suggestions that apply ' +
      '(with how many apply in all), derived from the runtime, credentials, the main agent, capability readiness and the setup checklist. Read-only: it never writes and never starts a turn.',
    responses: { 200: stateResponse },
    handler: async (_req, ctx) => {
      try {
        const facts = await gatherHomeFacts({
          runtime: ctx.runtime,
          canGenerateImage: () => ctx.hooks.invoke<boolean>('images.canGenerate', {}),
        })
        const state = homeState(facts)
        // Suggestions are for a home that already works: first things first.
        const suggestions = state.name === 'ready' ? await applicableSuggestions(facts) : []
        const body: HomeStateResponse = {
          ok: true,
          state,
          starters: availableStarters(HOME_CONTENT.starters, facts.starters).map((starter) => ({
            id: starter.id,
            title: starter.title,
            description: starter.description,
            prompt: starter.prompt,
            needsAttachment: starter.needs.attachment === true,
          })),
          personalities: HOME_CONTENT.personalities.map(({ id, label, sample }) => ({ id, label, sample })),
          hello: offersHello(facts.decisions),
          introductionSkipped: facts.decisions.introduction?.status === 'skipped',
          ...(state.name === 'needs-login' ? { login: loginFor() } : {}),
          suggestions: suggestions.slice(0, MAX_SHOWN),
          suggestionCount: suggestions.length,
        }
        return Response.json(body)
      } catch (err) {
        log.error('home state route failed', err instanceof Error ? err : new Error(String(err)))
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),
  defineRoute({
    path: '/introduction',
    method: 'POST',
    summary: 'Introduce the main agent',
    description:
      'Writes the introduction\'s answers: the main agent\'s name and personality, what to call the person, then a local agent sync. ' +
      'The writes are resumable, not atomic: on a failure the answers stay pending, GET /state keeps answering meet-agent with them, and posting again finishes the job.',
    body: introductionAnswersSchema,
    responses: { 200: okResponse, 400: errorResponse, 502: introductionFailed },
    handler: async (_req, ctx, { body }) => {
      try {
        const agentId = await getRuntimeMainAgentId(ctx.runtime)
        const result = await completeIntroduction(agentId, body, {
          updateIdentity: (update) => ctx.hooks.invoke('team.updateIdentity', update),
          setOperatorName,
          syncAgents,
        })
        if (!result.ok) {
          log.warn('introduction did not finish', { step: result.step, error: result.error })
          return Response.json(result, { status: 502 })
        }
        // The plugin's id is prefixed by the host.
        ctx.activity.audit('introduction_completed', 'human', { agent: agentId })
        return Response.json({ ok: true })
      } catch (err) {
        if (err instanceof UnknownPersonalityError) return Response.json({ ok: false, error: err.message }, { status: 400 })
        log.error('introduction route failed', err instanceof Error ? err : new Error(String(err)))
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/hello',
    method: 'POST',
    summary: 'Record that the person said hello',
    description: 'Called after the first hello was sent, or put away with "Not now", so Home stops offering it. The message itself is an ordinary chat message the person sent.',
    responses: { 200: okResponse },
    handler: async () => {
      recordHello()
      return Response.json({ ok: true })
    },
  }),

  defineRoute({
    path: '/tour',
    method: 'GET',
    activityClass: 'routine',
    summary: 'The tour of Bakin',
    description: 'The slides of the tour Home offers: one per area, each with what it is for, one thing to do there first, and its page. Curated content; the same for every home.',
    responses: { 200: z.object({ ok: z.literal(true), slides: z.array(z.object({ id: z.string(), title: z.string(), icon: z.enum(TOUR_ICONS), body: z.string(), first: z.string(), href: z.string() })) }) },
    handler: async () => {
      const body: HomeTourResponse = { ok: true, slides: HOME_CONTENT.tour }
      return Response.json(body)
    },
  }),

  defineRoute({
    path: '/suggestions/:id/dismiss',
    method: 'POST',
    summary: 'Put a suggestion away',
    description: '"Not now": records the time, and Home stops showing that suggestion for thirty days. It comes back afterwards if it still applies. 404 for an id that is not a suggestion.',
    params: z.object({ id: z.string() }),
    responses: { 200: okResponse, 404: errorResponse },
    handler: async (_req, ctx, { params }) => {
      if (!HOME_CONTENT.suggestions.some((suggestion) => suggestion.id === params.id)) {
        return Response.json({ ok: false, error: `No suggestion "${params.id}"` }, { status: 404 })
      }
      const at = new Date().toISOString()
      updateDecisions((current) => ({ ...current, dismissedSuggestions: { ...current.dismissedSuggestions, [params.id]: { at } } }))
      // Every open browser counts suggestions in its sidebar: tell them the count moved.
      ctx.events.emit('home.suggestions_changed', { id: params.id })
      return Response.json({ ok: true })
    },
  }),

  defineRoute({
    path: '/introduction/skip',
    method: 'POST',
    summary: 'Skip the introduction',
    description: 'Records that the person skipped the introduction, so Home stops opening on it. It can be reopened at any time.',
    responses: { 200: okResponse },
    handler: async () => {
      skipIntroduction()
      return Response.json({ ok: true })
    },
  }),
]

const homePlugin: BakinPlugin = definePlugin({
  id: 'home',
  name: 'Home',
  version: '0.1.0',
  routes,

  async activate() {
    log.info('Home plugin activated')
  },
})

export default homePlugin
