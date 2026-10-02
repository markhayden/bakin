/**
 * GET /api/approvals?status=pending[&taskIds=a,b] · POST /api/approvals/:id/resolve
 *
 * The board is the inbox (spec D7): task cards and task detail read pending
 * approval records here and resolve them here, whatever their kind. The
 * decision actor is the OS user (single-operator box behind Tailscale) so
 * audit trails identify who clicked with machine-level granularity — the
 * same rule the workflow gate routes used.
 */
import { userInfo } from 'os'
import { z } from 'zod'
import { listApprovalRecords, type ApprovalStatus } from '@bakin/core/approvals'
import { approvalErrorStatus, resolveApproval } from '@/core/approvals'

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

  const { username } = userInfo()
  try {
    const record = await resolveApproval(approvalId, {
      option: parsed.data.option,
      ...(parsed.data.comment ? { comment: parsed.data.comment } : {}),
      actor: { source: 'web', id: username, displayName: username },
    })
    return Response.json({ ok: true, approval: record })
  } catch (err) {
    const status = approvalErrorStatus(err)
    if (status === null) throw err
    return Response.json({ ok: false, error: (err as Error).message }, { status })
  }
}
