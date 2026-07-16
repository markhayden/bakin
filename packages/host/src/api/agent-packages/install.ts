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
 * Path lives under `/api/agent-packages/...` (not `/api/agents/...`) to
 * avoid collision with the runtime agent surface.
 */
import { z } from 'zod'
import { installPackage } from '@/core/agent-packages/installer'
import { createLogger } from '@/core/logger'

const log = createLogger('api:agent-packages:install')

const InstallBodySchema = z.object({
  source: z.string().min(1),
  type: z.enum(['local', 'github']).optional(),
  adopt: z.string().min(1).optional(),
  replace: z.boolean().optional(),
  installAs: z.string().regex(/^[a-z0-9][a-z0-9-_]{0,39}$/i, { message: 'installAs must be a package id (no slashes)' }).optional(),
})

export async function post(req: Request, _url: URL): Promise<Response> {
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

  try {
    const result = await installPackage({
      source: parsed.data.source,
      adopt: !!parsed.data.adopt,
      replace: parsed.data.replace,
      installAs: parsed.data.installAs,
    })
    return Response.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('agents/install failed', err as Error, { source: parsed.data.source })
    // 409 for "already managed" / collisions; 500 otherwise. Cheap heuristic.
    const isConflict = /already managed|exists in runtime|collision/i.test(message)
    return Response.json({ ok: false, error: message }, { status: isConflict ? 409 : 500 })
  }
}
