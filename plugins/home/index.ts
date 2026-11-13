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
import { setOperatorName } from '../../src/core/team-context'
import { HOME_CONTENT } from './lib/content'
import { introductionAnswersSchema } from './lib/decisions'
import { completeIntroduction, recordHello, skipIntroduction, UnknownPersonalityError } from './lib/introduction'
import { gatherHomeFacts } from './lib/readiness'
import { availableStarters, homeState, offersHello } from './lib/state'
import type { HomeStateResponse } from './types'

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
})

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
      'The Home state (unavailable, meet-agent, needs-login or ready) and the starters this home can run, derived from the runtime, ' +
      'credentials, the main agent and capability readiness. Read-only: it never writes and never starts a turn.',
    responses: { 200: stateResponse },
    handler: async (_req, ctx) => {
      try {
        const facts = await gatherHomeFacts({
          runtime: ctx.runtime,
          canGenerateImage: () => ctx.hooks.invoke<boolean>('images.canGenerate', {}),
        })
        const body: HomeStateResponse = {
          ok: true,
          state: homeState(facts),
          starters: availableStarters(HOME_CONTENT.starters, facts.starters).map((starter) => ({
            id: starter.id,
            title: starter.title,
            description: starter.description,
            prompt: starter.prompt,
            needsAttachment: starter.needs.attachment === true,
          })),
          personalities: HOME_CONTENT.personalities.map(({ id, label, sample }) => ({ id, label, sample })),
          hello: offersHello(facts.decisions),
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
