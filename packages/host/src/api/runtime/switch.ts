/**
 * `POST /api/runtime/switch` — the runtime switch (or its dry-run preview) as
 * an operation (#895): 202 `{ operationId, bootId }` (200 `attached` for an
 * identical live request); the phases are stages and the result body is the
 * switch report. Not cancellable. A malformed body answers 400 before
 * anything starts — a type-confused preview (`dryRun: "true"`) must never
 * fail open into a real switch.
 */
import { operationOriginFromRequest } from '@bakin/core/operations'
import { runtimeSwitchOperation } from '@/core/runtime-switch'
import { RuntimeSwitchRequestSchema } from '@/core/runtime-switch-request'
import { startOperationResponse } from '../operations'

export async function post(req: Request): Promise<Response> {
  const parsed = RuntimeSwitchRequestSchema.safeParse(await req.json().catch(() => undefined))
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
    return Response.json({ error: `Invalid runtime switch request — ${detail}` }, { status: 400 })
  }
  return startOperationResponse(runtimeSwitchOperation(parsed.data, operationOriginFromRequest(req)))
}
