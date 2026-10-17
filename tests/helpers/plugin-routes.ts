/**
 * The plugin install/upgrade routes as their clients drive them (#895):
 * every request is an operation, settled here into the Response the route
 * used to answer (`settleRoute`). Install previews never install, so a
 * preview that ends `ready` (nothing needs consent) is committed with the
 * same body — what Explore, the CLI and onboarding do. A preview awaiting
 * consent comes back as-is for the test to answer.
 */
import { post as installRoute } from '../../packages/host/src/api/plugins/install'
import { post as upgradeRoute } from '../../packages/host/src/api/plugins/upgrade'
import { settleRoute } from './operation-route'

export async function installPOST(req: Request, _url?: URL): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(await req.clone().text()) as Record<string, unknown>
  } catch {
    return settleRoute(installRoute(req)) // an unparseable body is the route's own 400
  }
  const first = await settleRoute(installRoute(req))
  if (body.accepted === true || body.dev === true) return first
  const answer = await first.clone().json().catch(() => null) as Record<string, unknown> | null
  if (answer?.ready !== true) return first
  return settleRoute(installRoute(new Request(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, accepted: true }),
  })))
}

/** The upgrade route settled — preview and commit stay separate calls. */
export async function upgradePOST(req: Request, _url?: URL): Promise<Response> {
  return settleRoute(upgradeRoute(req))
}
