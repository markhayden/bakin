/**
 * GET /api/approvals?status=pending[&taskIds=a,b] · POST /api/approvals/:id/resolve
 *
 * The board is the inbox (spec D7): task cards and task detail read pending
 * approval records here and resolve them here, whatever their kind. The
 * decision's provenance comes from the transport only (#898 D-H4): the
 * board declares the operator with `X-Bakin-Operator: declared`, the CLI
 * with `--as human`; anything else is refused before any side effect.
 */
import { z } from 'zod'
import { approvalProvenanceFromRequest, listApprovalRecords, type ApprovalStatus } from '@bakin/core/approvals'
import { ApprovalRefusedError, agentContextForPath, approvalErrorStatus, resolveApproval } from '@/core/approvals'

const statusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired'])
const resolveBody = z.object({
  option: z.string().min(1).max(64),
  comment: z.string().max(4000).optional(),
})

function parseTaskIds(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean)
  return ids.length > 0 ? ids : undefined
}

export async function get(_req: Request, url: URL): Promise<Response> {
  const rawStatus = url.searchParams.get('status') ?? 'pending'
  const status = statusSchema.safeParse(rawStatus)
  if (!status.success) return Response.json({ ok: false, error: `invalid status: ${rawStatus}` }, { status: 400 })
  const approvals = listApprovalRecords({ status: status.data as ApprovalStatus, taskIds: parseTaskIds(url.searchParams.get('taskIds')) })
  return Response.json({ approvals })
}

const RESOLVE_PATH = /^\/api\/approvals\/([^/]+)\/resolve$/

export function approvalIdFromPath(pathname: string): string | null {
  const match = RESOLVE_PATH.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}

export async function resolve(req: Request, url: URL): Promise<Response> {
  const approvalId = approvalIdFromPath(url.pathname)
  if (!approvalId) return Response.json({ ok: false, error: 'approval id required' }, { status: 400 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const parsed = resolveBody.safeParse(body)
  if (!parsed.success) return Response.json({ ok: false, error: 'invalid input', issues: parsed.error.issues }, { status: 400 })

  try {
    const record = await resolveApproval(approvalId, {
      option: parsed.data.option,
      ...(parsed.data.comment ? { comment: parsed.data.comment } : {}),
      provenance: approvalProvenanceFromRequest(req),
    })
    return Response.json({ ok: true, approval: record })
  } catch (err) {
    const status = approvalErrorStatus(err)
    if (status === null) throw err
    return Response.json({ ok: false, error: (err as Error).message, ...(err instanceof ApprovalRefusedError ? { code: err.code } : {}) }, { status })
  }
}

/**
 * GET /api/approvals/agent-context?cwd=<absolute path> → { agentId | null }.
 * The CLI asks before honoring `--as human` (#898 D-H5): a cwd inside an
 * agent's run dir or workspace is that agent's context.
 */
export async function agentContext(_req: Request, url: URL): Promise<Response> {
  const cwd = url.searchParams.get('cwd')
  if (!cwd || !cwd.startsWith('/')) return Response.json({ ok: false, error: 'cwd must be an absolute path' }, { status: 400 })
  return Response.json({ agentId: await agentContextForPath(cwd) })
}
