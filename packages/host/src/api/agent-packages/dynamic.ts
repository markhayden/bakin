/**
 * Dispatcher for /api/agent-packages/{agentId}/* routes.
 *
 * Routes covered:
 *   DELETE /api/agent-packages/{agentId}                      remove the package
 *   POST   /api/agent-packages/{agentId}/sync                 sync the agent (fetch + recompose + verify)
 *   GET    /api/agent-packages/{agentId}/receipt              latest sync receipt
 *   POST   /api/agent-packages/migrate                        one-time block migration (confirmed upstream)
 *   GET    /api/agent-packages/{agentId}/lessons              list lessons + state
 *   POST   /api/agent-packages/{agentId}/lessons/{lessonId}   toggle lesson
 *
 * The path family is `/api/agent-packages/...` rather than `/api/agents/...`
 * to avoid collision with the existing runtime surface (`/api/agents/{id}/
 * status`, `/message`, `/tasks` used by the Teams UI for runtime
 * ops). The two surfaces are conceptually distinct: the runtime surface
 * controls a live agent; this surface controls the install record + the
 * projection state.
 */
import { z } from 'zod'
import { PackageStillRequiredError } from '@/core/agent-packages/errors'
import { removePackageById } from '@/core/agent-packages/uninstaller'
import { MigrationRequiredError, syncAgent } from '@/core/agent-packages/sync'
import { migrateToManagedBlocks } from '@/core/agent-packages/migration'
import { readReceipt } from '@/core/agent-packages/receipts'
import { scanAgentSync } from '@/core/agent-packages/sync-scanner'
import { reloadAgentPackageRegistries } from '@/core/agent-packages/post-sync-reload'
import {
  listLessons,
  setLessonEnabled,
} from '@/core/agent-packages/lesson-toggle'
import { findAgentPackage, readLockfile } from '@bakin/core/agent-packages/lockfile'
import { parseJsonBodyWeb } from '@/core/middleware'
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

const SyncBodySchema = z
  .object({
    check: z.boolean().optional(),
    reclaim: z.union([z.literal('all'), z.array(z.string())]).optional(),
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

  // /api/agent-packages/migrate <- POST (one-time block migration; the
  // caller — CLI prompt or doctor repair confirm — owns user consent)
  if (segments.length === 3 && agentId === 'migrate' && req.method === 'POST') {
    return handleMigrate()
  }

  // /api/agent-packages/{agentId} <- DELETE = remove
  if (segments.length === 3 && req.method === 'DELETE') {
    return handleRemove(req, agentId)
  }

  // /api/agent-packages/{agentId}/sync <- POST
  if (segments.length === 4 && segments[3] === 'sync' && req.method === 'POST') {
    return handleSync(req, agentId)
  }

  // /api/agent-packages/{agentId}/receipt <- GET
  if (segments.length === 4 && segments[3] === 'receipt' && req.method === 'GET') {
    const receipt = readReceipt(agentId)
    if (!receipt) {
      return Response.json({ ok: false, error: `No sync receipt for "${agentId}" yet.` }, { status: 404 })
    }
    return Response.json({ ok: true, receipt })
  }

  // /api/agent-packages/{agentId}/scan <- GET (read-only live drift scan, #385)
  if (segments.length === 4 && segments[3] === 'scan' && req.method === 'GET') {
    return handleScan(agentId)
  }

  // /api/agent-packages/{agentId}/lessons <- GET
  if (segments.length === 4 && segments[3] === 'lessons' && req.method === 'GET') {
    return handleLessonsList(agentId)
  }

  // /api/agent-packages/{agentId}/lessons/{lessonId} <- POST
  if (segments.length === 5 && segments[3] === 'lessons' && req.method === 'POST') {
    return handleLessonsToggle(req, agentId, segments[4])
  }

  return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
}

/**
 * Live single-agent drift scan (#385) — always-fresh findings for the
 * Diagnostics tab. Runs the same read-only scanner as the team.agent-sync
 * doctor check, scoped to one agent before workspace/package reads occur;
 * ZERO writes, no upstream fetch. Also matches findings by owning package so
 * package-scoped issues (source-missing etc.) aren't hidden.
 */
async function handleScan(agentId: string): Promise<Response> {
  try {
    const lock = readLockfile()
    const packageId = findAgentPackage(lock, agentId)?.id
    const report = await scanAgentSync(lock, { agentId })
    const findings = report.findings.filter(
      (f) => f.agentId === agentId || (packageId !== undefined && f.packageId === packageId),
    )
    return Response.json({
      ok: true,
      agentId,
      packageId: packageId ?? null,
      findings,
      scannedAt: new Date().toISOString(),
    })
  } catch (err) {
    log.error('agent-packages scan failed', err, { agentId })
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

async function handleRemove(req: Request, agentId: string): Promise<Response> {
  const packageId = resolvePackageIdForAgent(agentId)
  if (!packageId) {
    return Response.json(
      { ok: false, error: `No package installed for agent "${agentId}".` },
      { status: 404 },
    )
  }

  // Lenient parse — body is optional for DELETE; empty/invalid means "no options".
  const raw = await parseJsonBodyWeb(req) ?? {}
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
    const isConflict = err instanceof PackageStillRequiredError
    return Response.json({ ok: false, error: message }, { status: isConflict ? 409 : 500 })
  }
}

async function handleSync(req: Request, agentId: string): Promise<Response> {
  // Lenient parse — empty/invalid body means "no options".
  const raw = await parseJsonBodyWeb(req) ?? {}
  const parsed = SyncBodySchema.safeParse(raw)
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
    const receipt = await syncAgent(agentId, {
      check: parsed.data?.check,
      reclaim: parsed.data?.reclaim,
      trigger: 'rest',
    })
    if (!parsed.data?.check) {
      await reloadAgentPackageRegistries({ kind: 'synced', agentId })
    }
    return Response.json({ ok: true, receipt })
  } catch (err) {
    if (err instanceof MigrationRequiredError) {
      return Response.json(
        { ok: false, migrationRequired: true, error: err.message },
        { status: 409 },
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('agents/sync failed', err as Error, { agentId })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

async function handleMigrate(): Promise<Response> {
  try {
    const result = await migrateToManagedBlocks({ trigger: 'rest' })
    if (!result.alreadyMigrated) {
      await reloadAgentPackageRegistries({ kind: 'migrated' })
    }
    return Response.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('agents/migrate failed', err as Error)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

function handleLessonsList(agentId: string): Response {
  const packageId = resolvePackageIdForAgent(agentId)
  if (!packageId) {
    return Response.json({ ok: true, packageId: null, lessons: [] })
  }
  try {
    const lessons = listLessons(packageId)
    return Response.json({ ok: true, packageId, lessons })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

async function handleLessonsToggle(
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
    const result = await setLessonEnabled(packageId, lessonId, parsed.data.enabled)
    return Response.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('agents/lessons/toggle failed', err as Error, { packageId, lessonId })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
