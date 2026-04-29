/**
 * POST /api/packages/install
 *
 * Installs a standalone skill-pack / workflow-pack / knowledge-pack.
 * Same body shape as /api/agents/install minus `adopt` (only agent
 * packages have a runtime-agent counterpart that adoption attaches to).
 */
import { z } from 'zod'
import { installPackage } from '@/core/agent-packages/installer'
import { createLogger } from '@/core/logger'

const log = createLogger('api:packages:install')

const InstallBodySchema = z.object({
  source: z.string().min(1),
  type: z.enum(['local', 'github']).optional(),
  replace: z.boolean().optional(),
  installAs: z.string().min(1).optional(),
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
      {
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
      { status: 400 },
    )
  }

  try {
    const result = await installPackage({
      source: parsed.data.source,
      replace: parsed.data.replace,
      installAs: parsed.data.installAs,
    })
    if (result.kind === 'agent') {
      // Agent packages must go through /api/agents/install — the surfaces
      // are deliberately separate so the adopt path lives in one place.
      return Response.json(
        {
          ok: false,
          error: 'Source is an agent package — use POST /api/agents/install instead.',
        },
        { status: 400 },
      )
    }
    return Response.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('packages/install failed', err as Error, { source: parsed.data.source })
    const isConflict = /already managed|already adopted|collision/i.test(message)
    return Response.json({ ok: false, error: message }, { status: isConflict ? 409 : 500 })
  }
}
