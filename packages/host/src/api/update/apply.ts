/**
 * POST /api/update/apply
 *
 * Runs the same binary replacement path as `bakin update`, guarded so browser
 * sessions started from Bun/source mode cannot overwrite `process.execPath`.
 */
import { APP_VERSION } from '@bakin/core/constants'
import { getSelfUpdateStatus, selfUpdate } from '@/core/self-update'
import { scheduleServerRestart } from '@/core/server-restart'

interface ApplyUpdateDeps {
  getStatus?: typeof getSelfUpdateStatus
  runSelfUpdate?: typeof selfUpdate
  scheduleRestart?: typeof scheduleServerRestart
}

export async function post(_req: Request, _url: URL, deps: ApplyUpdateDeps = {}): Promise<Response> {
  void _req
  void _url

  const getStatus = deps.getStatus ?? getSelfUpdateStatus
  const runSelfUpdate = deps.runSelfUpdate ?? selfUpdate
  const scheduleRestart = deps.scheduleRestart ?? scheduleServerRestart

  const status = await getStatus({ currentVersion: APP_VERSION })
  if (!status.supported) {
    return Response.json({
      ok: false,
      supported: false,
      reason: status.reason,
      error: `Bakin update is not available from this runtime: ${status.reason ?? 'unsupported runtime'}.`,
    }, { status: 400 })
  }

  const events: Array<{ level: 'info' | 'error'; message: string }> = []
  const exitCode = await runSelfUpdate({
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

  const restart = scheduleRestart()
  const message = restart.ok
    ? 'Bakin update completed. Restarting Bakin now...'
    : 'Bakin update completed, but automatic restart could not be scheduled. Restart Bakin manually to use the new version.'

  return Response.json({
    ok: true,
    message,
    restart,
    events,
  })
}
