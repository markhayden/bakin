/**
 * POST /api/server/shutdown — the ONLY way `bakin stop` / `restart` ends a
 * server (#898 K). The CLI never signals a pid it merely verified (verify →
 * exit → pid reuse → signal is a race no re-check closes); it ASKS, and the
 * server decides against its own memory:
 *   - `X-Bakin-Cli-Secret` must be THIS boot's lock secret (written 0600
 *     into this home's server.lock — the home-operator proof, #895 D11);
 *   - `{ bootId }` must be THIS process's boot id, so a request meant for a
 *     predecessor or another home can never stop the wrong generation.
 * Accepted → 202, then the normal graceful shutdown.
 */
import { CLI_SECRET_HEADER, cliSecretMatches } from '@/core/server-lock'
import { getBootId } from '@/core/boot-id'
import { getServerState, triggerShutdown } from '@/core/lifecycle'
import { createLogger } from '@/core/logger'

const log = createLogger('server-shutdown-route')

export async function post(req: Request, _url: URL): Promise<Response> {
  void _url
  if (!cliSecretMatches(req.headers.get(CLI_SECRET_HEADER))) {
    return Response.json({ ok: false, error: 'not_this_home', message: 'The request does not carry this server\'s lock secret.' }, { status: 403 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch (err) {
    log.debug('Shutdown request body was not JSON', { error: err instanceof Error ? err.message : String(err) })
    return Response.json({ ok: false, error: 'invalid_body', message: 'Expected { "bootId": "<this server\'s boot id>" }.' }, { status: 400 })
  }
  const bootId = typeof (body as { bootId?: unknown })?.bootId === 'string' ? (body as { bootId: string }).bootId : ''
  if (bootId !== getBootId()) {
    return Response.json({ ok: false, error: 'boot_mismatch', message: 'This server is a different boot than the one the request names.', bootId: getBootId() }, { status: 409 })
  }
  log.info('Shutdown requested by this home\'s CLI', { bootId })
  // Answer first; the graceful chain starts once the response is written.
  if (getServerState() !== 'stopping') setTimeout(() => triggerShutdown('cli-shutdown', 0), 50)
  return Response.json({ ok: true, pid: process.pid, bootId: getBootId() }, { status: 202 })
}
