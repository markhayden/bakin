/**
 * /api/channels — the ONE channel-readiness surface (channel-readiness spec
 * §4.5):
 *
 *   GET  /api/channels              the snapshot (`?refresh=1` collects first)
 *   POST /api/channels/reconnect    bump the bridge to the latest config (202;
 *                                   `?wait=1` long-polls the settled snapshot;
 *                                   409 owner_is_runtime on a native runtime)
 *   POST /api/channels/verify       read-only probe — never sends (409 while
 *                                   connecting)
 *   PUT  /api/channels/routing      alert/approvals channels + alias map with
 *                                   REPLACE semantics (deepMerge keeps omitted
 *                                   keys, so deletes need this path)
 *
 * No value of any secret ever crosses this surface.
 */
import { z } from 'zod'
import { DELIVERABLE_STATES } from '@bakin/core/delivery'
import { getDeliveryBridge } from '@/core/delivery'
import {
  getChannelReadiness,
  refreshChannelReadiness,
  rebuildChannelReadiness,
  verifyChannels,
} from '@/core/delivery/readiness'
import { createLogger } from '@/core/logger'
import { replaceSettingsValue, updateSettings } from '@/core/settings'

const log = createLogger('channels-api')

export const RECONNECT_WAIT_MS = 45_000

const ALIAS_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const routingBody = z.object({
  alertChannel: z.string().trim().max(200).nullable(),
  approvalsEnabled: z.boolean(),
  approvalsChannel: z.string().trim().max(200).nullable(),
  aliases: z.record(
    z.string().regex(ALIAS_NAME_RE, 'alias names are lowercase letters, digits, and dashes'),
    z.string().trim().min(1).max(200),
  ),
})

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

export async function get(_req: Request, url: URL): Promise<Response> {
  const readiness = url.searchParams.get('refresh') === '1'
    ? await refreshChannelReadiness('operator')
    : getChannelReadiness()
  return json(readiness)
}

export async function reconnect(_req: Request, url: URL): Promise<Response> {
  const current = getChannelReadiness()
  if (current.owner === 'runtime') {
    return json({ error: 'owner_is_runtime', readiness: current, message: 'The active runtime delivers natively; the Bakin bridge is idle by design.' }, 409)
  }
  const settled = getDeliveryBridge().reconcile('operator')
  settled.catch((err) => { log.warn('Operator reconcile failed', err) })
  // Let the loop publish `connecting` before we snapshot.
  await Promise.resolve()
  if (url.searchParams.get('wait') !== '1') {
    return json({ readiness: rebuildChannelReadiness() }, 202)
  }
  const outcome = await Promise.race([
    settled.then(() => 'settled' as const, () => 'settled' as const),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), RECONNECT_WAIT_MS)),
  ])
  const readiness = await refreshChannelReadiness('reconnect')
  if (outcome === 'timeout' && !DELIVERABLE_STATES.includes(readiness.connection.state) && readiness.connection.state === 'connecting') {
    return json({ readiness }, 202)
  }
  return json({ readiness })
}

export async function verify(_req: Request, _url: URL): Promise<Response> {
  const current = getChannelReadiness()
  if (current.connection.state === 'connecting') {
    return json({ error: 'connecting', readiness: current, message: 'The bridge is still connecting — verify once it settles.' }, 409)
  }
  const result = await verifyChannels()
  return json(result)
}

export async function putRouting(req: Request, _url: URL): Promise<Response> {
  const parsed = routingBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'invalid routing body' }, 400)
  const { alertChannel, approvalsEnabled, approvalsChannel, aliases } = parsed.data
  updateSettings({
    notifications: { channel: alertChannel ?? '' },
    approvals: { channelAlerts: approvalsEnabled, channel: approvalsChannel ?? '' },
  })
  replaceSettingsValue('notifications.channelAliases', aliases)
  const readiness = await refreshChannelReadiness('routing')
  return json({ ok: true, readiness })
}

/** One dispatcher for the whole /api/channels surface. */
export async function handler(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '')
  if (path === '/api/channels' && req.method === 'GET') return get(req, url)
  if (path === '/api/channels/reconnect' && req.method === 'POST') return reconnect(req, url)
  if (path === '/api/channels/verify' && req.method === 'POST') return verify(req, url)
  if (path === '/api/channels/routing' && req.method === 'PUT') return putRouting(req, url)
  return json({ error: 'Not found', path: url.pathname }, 404)
}
