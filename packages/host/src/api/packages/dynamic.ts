/**
 * Dispatcher for /api/packages/{packageId}/* routes (standalone packs).
 *
 *   DELETE /api/packages/{packageId}                  remove (refuses w/ refCount > 0)
 *   POST   /api/packages/{packageId}/update           update at recorded ref
 *
 * The packageId here is the lockfile key — for standalone packs that's
 * `<id>@<version>` (e.g. "madeinwyo.bakin-skills-visual@0.3.1"). The CLI
 * URL-encodes the `@` so the path-segment match below works without
 * extra parsing.
 */
import { z } from 'zod'
import { removePackageById } from '@/core/agent-packages/uninstaller'
import { updatePackageById } from '@/core/agent-packages/updater'
import { createLogger } from '@/core/logger'

const log = createLogger('api:packages:dynamic')

const RemoveBodySchema = z
  .object({
    keepBlocks: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .optional()
  .default({})

const UpdateBodySchema = z
  .object({
    refreshTemplate: z.boolean().optional(),
  })
  .optional()
  .default({})

export async function handler(req: Request, url: URL): Promise<Response> {
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 3 || segments[0] !== 'api' || segments[1] !== 'packages') {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  // segments[2] is URL-encoded; decodeURIComponent restores the `@` etc.
  const packageId = decodeURIComponent(segments[2])

  if (segments.length === 3 && req.method === 'DELETE') {
    return handleRemove(req, packageId)
  }
  if (segments.length === 4 && segments[3] === 'update' && req.method === 'POST') {
    return handleUpdate(req, packageId)
  }

  return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
}

async function handleRemove(req: Request, packageId: string): Promise<Response> {
  let raw: unknown = {}
  try {
    raw = await req.json()
  } catch {
    /* empty body OK */
  }
  const parsed = RemoveBodySchema.safeParse(raw)
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
    const result = await removePackageById({
      packageId,
      keepBlocks: parsed.data?.keepBlocks,
      force: parsed.data?.force,
    })
    return Response.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('packages/remove failed', err as Error, { packageId })
    const status = /still required by/i.test(message)
      ? 409
      : /not installed/i.test(message)
        ? 404
        : 500
    return Response.json({ ok: false, error: message }, { status })
  }
}

async function handleUpdate(req: Request, packageId: string): Promise<Response> {
  let raw: unknown = {}
  try {
    raw = await req.json()
  } catch {
    /* empty body OK */
  }
  const parsed = UpdateBodySchema.safeParse(raw)
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
    const result = await updatePackageById({
      packageId,
      refreshTemplate: parsed.data?.refreshTemplate,
    })
    return Response.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('packages/update failed', err as Error, { packageId })
    const status = /not installed/i.test(message) ? 404 : 500
    return Response.json({ ok: false, error: message }, { status })
  }
}
