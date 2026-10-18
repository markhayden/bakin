/**
 * POST /api/agent-packages/install
 *
 * Body shape: { source: string, type: 'local' | 'github', adopt?: string,
 *               replace?: boolean, installAs?: string }
 *
 * Wraps `installPackage` from src/core/agent-packages/installer. Body
 * validation lives here; correctness checks (collision, agent state,
 * etc.) live in the installer and surface as 4xx/5xx with the installer's
 * error message intact.
 *
 * Runs as an operation (#895): 202 `{ operationId, bootId }` at once; the
 * body this route used to answer is the operation's `result`.
 *
 * Path lives under `/api/agent-packages/...` (not `/api/agents/...`) to
 * avoid collision with the runtime agent surface.
 */
import { z } from 'zod'
import { OperationCancelledError, operationOriginFromRequest, responseOutcome } from '@bakin/core/operations'
import { installPackage, type InstallResult } from '@/core/agent-packages/installer'
import { PACKAGE_INSTALL_PLAN } from '@/core/agent-packages/operation-plans'
import { createLogger } from '@/core/logger'
import { startOperationResponse } from '../operations'

const log = createLogger('api:agent-packages:install')

/** The operation's result body — what this route answered before #895. */
type AgentInstallBody = { ok: true; result: InstallResult } | { ok: false; error: string }

const InstallBodySchema = z.object({
  source: z.string().min(1),
  type: z.enum(['local', 'github']).optional(),
  adopt: z.string().min(1).optional(),
  replace: z.boolean().optional(),
  installAs: z.string().regex(/^[a-z0-9][a-z0-9-_]{0,39}$/i, { message: 'installAs must be a package id (no slashes)' }).optional(),
})

export async function post(req: Request): Promise<Response> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = InstallBodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    )
  }

  const data = parsed.data
  return startOperationResponse<AgentInstallBody>({
    kind: 'install',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `${data.adopt ? 'Adopt' : 'Install'} ${data.installAs ?? data.source}`,
    href: '/team',
    fingerprint: `agent-packages:install:${data.source}|${data.installAs ?? ''}|${data.adopt ? 'adopt' : ''}|${data.replace ? 'replace' : ''}`,
    resources: ['install-state'],
    plan: PACKAGE_INSTALL_PLAN,
    run: async (op) => {
      try {
        const result = await installPackage({
          source: data.source,
          adopt: !!data.adopt,
          replace: data.replace,
          installAs: data.installAs,
          op,
        })
        return responseOutcome(200, { ok: true, result })
      } catch (err) {
        if (err instanceof OperationCancelledError) throw err
        const message = err instanceof Error ? err.message : String(err)
        log.error('agents/install failed', err as Error, { source: data.source })
        // 409 for "already managed" / collisions; 500 otherwise. Cheap heuristic.
        const isConflict = /already managed|exists in runtime|collision/i.test(message)
        return responseOutcome(isConflict ? 409 : 500, { ok: false, error: message })
      }
    },
  })
}
