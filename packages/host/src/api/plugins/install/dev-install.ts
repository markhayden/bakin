/**
 * Install phase (a) — the dev-install/link branch (`dev: true`).
 *
 * Symlinks the local source as a linked plugin, live-activates it when the
 * registry is up, and optionally starts the hot-reload watcher — the same
 * link operation as `bakin plugins link` (#895). Never touches the
 * staging/copy/build pipeline the normal install path uses.
 */
import { startLinkOperation } from '../link'
import type { InstallBody } from './body'

/** Handle a `dev: true` install request. Mirrors `bakin plugins link`. */
export async function handleDevInstall(req: Request, body: InstallBody): Promise<Response> {
  if (body.type !== 'local') {
    return Response.json({
      ok: false,
      error: 'dev installs only support local plugin paths; clone the source locally and run `bakin plugins install --dev <path>`',
    }, { status: 400 })
  }
  return startLinkOperation(req, body.source, body.force === true, 'dev-install')
}
