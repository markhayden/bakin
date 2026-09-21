/**
 * GET /api/install-jobs/:id — install-job status + final result (#895).
 * The SSE stream is best-effort display; THIS is the durable-within-process
 * answer (poll fallback, reload rehydration, missed-event recovery). A 404
 * after a server restart means "outcome unknown — refresh the list views".
 */
import { getInstallJob } from '@/core/agent-packages/install-progress'

export async function get(_req: Request, url: URL): Promise<Response> {
  const id = url.pathname.split('/').pop() ?? ''
  const job = getInstallJob(id)
  if (!job) {
    return Response.json({ ok: false, error: 'No such install job (it may predate a server restart).' }, { status: 404 })
  }
  return Response.json({ ok: true, job })
}
