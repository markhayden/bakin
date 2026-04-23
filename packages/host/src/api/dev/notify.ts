/**
 * POST /api/dev/notify — dev watcher → browser bridge.
 *
 * The dev watcher (scripts/dev.ts) POSTs rebuild events here; this handler
 * validates the event shape and forwards it to every connected dev SSE
 * client via `broadcastDev`.
 *
 * BAKIN_DEV gate mirrors events.ts — defense in depth against a misconfig
 * that registers the route in production.
 */
import { z } from 'zod'
import { broadcastDev, type DevEvent } from './events'

const devScope = z.enum(['shell', 'plugin', 'sdk', 'css', 'server'])

const devEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dev:ready') }),
  z.object({ type: z.literal('dev:building'), scope: devScope }),
  z.object({ type: z.literal('dev:css') }),
  z.object({ type: z.literal('dev:reload'), scope: devScope }),
  z.object({
    type: z.literal('dev:hot-swap'),
    scope: z.literal('plugin'),
    id: z.string().min(1),
    version: z.string().min(1),
  }),
  z.object({
    type: z.literal('dev:error'),
    scope: devScope,
    message: z.string(),
    stderr: z.string().optional(),
  }),
  z.object({ type: z.literal('dev:recover'), scope: devScope }),
])

export async function post(req: Request): Promise<Response> {
  if (process.env.BAKIN_DEV !== '1') {
    return new Response('Not found', { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = devEventSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid event shape', issues: parsed.error.issues }, { status: 400 })
  }

  broadcastDev(parsed.data as DevEvent)
  return Response.json({ ok: true })
}
