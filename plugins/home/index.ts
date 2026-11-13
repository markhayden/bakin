/**
 * Home plugin — server entry point.
 * The page Bakin opens on. What it shows is derived from the home's real
 * state; the only things stored are decisions a person made.
 * Deep reference: `.claude/knowledge/home.md`.
 */
import { z } from 'zod'
import type { BakinPlugin } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'
import { HOME_CONTENT } from './lib/content'
import { gatherHomeFacts } from './lib/readiness'
import { availableStarters, homeState } from './lib/state'
import type { HomeStateResponse } from './types'

const log = createLogger('home')

const agentShape = z.object({ id: z.string(), name: z.string() })
const stateResponse = z.object({
  ok: z.literal(true),
  state: z.discriminatedUnion('name', [
    z.object({ name: z.literal('unavailable'), reason: z.enum(['runtime_unreachable', 'model_cannot_run']), detail: z.string().optional(), href: z.string() }),
    z.object({ name: z.literal('meet-agent'), agent: agentShape }),
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
})

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
        }
        return Response.json(body)
      } catch (err) {
        log.error('home state route failed', err instanceof Error ? err : new Error(String(err)))
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
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
