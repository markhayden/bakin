/**
 * POST /api/update/apply
 *
 * Runs the same binary replacement path as `bakin update`, guarded so browser
 * sessions started from Bun/source mode cannot overwrite `process.execPath`.
 */
import { APP_VERSION } from '@bakin/core/constants'
import { getSelfUpdateStatus, selfUpdate } from '@/core/self-update'

export async function post(_req: Request, _url: URL): Promise<Response> {
  void _req
  void _url

  const status = await getSelfUpdateStatus({ currentVersion: APP_VERSION })
  if (!status.supported) {
    return Response.json({
      ok: false,
      supported: false,
      reason: status.reason,
      error: `Bakin update is not available from this runtime: ${status.reason ?? 'unsupported runtime'}.`,
    }, { status: 400 })
  }

  const events: Array<{ level: 'info' | 'error'; message: string }> = []
  const exitCode = await selfUpdate({
    log: (message) => events.push({ level: 'info', message }),
    error: (message) => events.push({ level: 'error', message }),
  })

  if (exitCode !== 0) {
    const lastError = events.findLast((event) => event.level === 'error')
    return Response.json({
      ok: false,
      error: lastError?.message ?? 'Bakin update failed.',
      events,
    }, { status: 500 })
  }

  return Response.json({
    ok: true,
    message: events.at(-1)?.message ?? 'Bakin update completed. Restart Bakin to use the new version.',
    events,
  })
}
