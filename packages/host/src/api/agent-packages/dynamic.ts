/**
 * Dispatcher for /api/agent-packages/{agentId}/* routes.
 *
 * Routes covered:
 *   DELETE /api/agent-packages/{agentId}                       remove the package
 *   POST   /api/agent-packages/{agentId}/update                update the package
 *   GET    /api/agent-packages/{agentId}/knowledge             list lessons + state
 *   POST   /api/agent-packages/{agentId}/knowledge/{lessonId}  toggle lesson
 *
 * The path family is `/api/agent-packages/...` rather than `/api/agents/...`
 * to avoid collision with the existing runtime surface (`/api/agents/{id}/
 * status`, `/message`, `/tasks` used by the Teams UI for OpenClaw runtime
 * ops). The two surfaces are conceptually distinct: the runtime surface
 * controls a live agent; this surface controls the install record + the
 * projection state.
 */
import { z } from 'zod'
import { removePackageById } from '@/core/agent-packages/uninstaller'
import { updatePackageById } from '@/core/agent-packages/updater'
import {
  listKnowledge,
  setKnowledgeEnabled,
} from '@/core/agent-packages/knowledge-toggle'
import { findAgentPackage, readLockfile } from '@bakin/core/agent-packages/lockfile'
import { createLogger } from '@/core/logger'

const log = createLogger('api:agent-packages:dynamic')

const RemoveBodySchema = z
  .object({
    keepBlocks: z.boolean().optional(),
    deleteAgent: z.boolean().optional(),
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

const ToggleBodySchema = z.object({
  enabled: z.boolean(),
})

/** Resolve `agentId` (URL slug) → packageId (lockfile key). */
function resolvePackageIdForAgent(agentId: string): string | null {
  const lock = readLockfile()
  const owner = findAgentPackage(lock, agentId)
  return owner?.id ?? null
}

export async function handler(req: Request, url: URL): Promise<Response> {
  const segments = url.pathname.split('/').filter(Boolean) // ['api','agent-packages',...]
  if (segments.length < 3 || segments[0] !== 'api' || segments[1] !== 'agent-packages') {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const agentId = segments[2]
  if (!agentId) {
    return Response.json({ ok: false, error: 'Missing agent id' }, { status: 404 })
  }

  // /api/agent-packages/{agentId} <- DELETE = remove
  if (segments.length === 3 && req.method === 'DELETE') {
    return handleRemove(req, agentId)
  }

  // /api/agent-packages/{agentId}/update <- POST
  if (segments.length === 4 && segments[3] === 'update' && req.method === 'POST') {
    return handleUpdate(req, agentId)
  }

  // /api/agent-packages/{agentId}/knowledge <- GET
  if (segments.length === 4 && segments[3] === 'knowledge' && req.method === 'GET') {
    return handleKnowledgeList(agentId)
  }

  // /api/agent-packages/{agentId}/knowledge/{lessonId} <- POST
  if (segments.length === 5 && segments[3] === 'knowledge' && req.method === 'POST') {
    return handleKnowledgeToggle(req, agentId, segments[4])
  }

  return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
}

async function handleRemove(req: Request, agentId: string): Promise<Response> {
  const packageId = resolvePackageIdForAgent(agentId)
  if (!packageId) {
    return Response.json(
      { ok: false, error: `No package installed for agent "${agentId}".` },
      { status: 404 },
    )
  }

  let raw: unknown = {}
  try {
    raw = await req.json()
  } catch {
    // Body is optional for DELETE — empty body is fine
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
      deleteAgent: parsed.data?.deleteAgent,
      force: parsed.data?.force,
    })
    return Response.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('agents/remove failed', err as Error, { packageId })
    const isConflict = /still required by/i.test(message)
    return Response.json({ ok: false, error: message }, { status: isConflict ? 409 : 500 })
  }
}

async function handleUpdate(req: Request, agentId: string): Promise<Response> {
  const packageId = resolvePackageIdForAgent(agentId)
  if (!packageId) {
    return Response.json(
      { ok: false, error: `No package installed for agent "${agentId}".` },
      { status: 404 },
    )
  }

  let raw: unknown = {}
  try {
    raw = await req.json()
  } catch {
    // empty body OK
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
    log.error('agents/update failed', err as Error, { packageId })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

function handleKnowledgeList(agentId: string): Response {
  const packageId = resolvePackageIdForAgent(agentId)
  if (!packageId) {
    return Response.json(
      { ok: false, error: `No package installed for agent "${agentId}".` },
      { status: 404 },
    )
  }
  try {
    const lessons = listKnowledge(packageId)
    return Response.json({ ok: true, packageId, lessons })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

async function handleKnowledgeToggle(
  req: Request,
  agentId: string,
  lessonId: string,
): Promise<Response> {
  const packageId = resolvePackageIdForAgent(agentId)
  if (!packageId) {
    return Response.json(
      { ok: false, error: `No package installed for agent "${agentId}".` },
      { status: 404 },
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = ToggleBodySchema.safeParse(raw)
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
    const result = await setKnowledgeEnabled(packageId, lessonId, parsed.data.enabled)
    return Response.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('agents/knowledge/toggle failed', err as Error, { packageId, lessonId })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
