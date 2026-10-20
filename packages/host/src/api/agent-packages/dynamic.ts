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
 *
 * Remove, sync and migrate run as operations (#895): 202 `{ operationId,
 * bootId }`, with the body these routes used to answer as the operation's
 * `result`. The lesson toggle stays synchronous — bounded and local — and
 * takes install-state without waiting (409 `install_busy`).
 */
import { z } from 'zod'
import {
  OperationCancelledError,
  OperationRejectedError,
  ResourceBusyError,
  operationOriginFromRequest,
  responseOutcome,
} from '@bakin/core/operations'
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
import {
  MIGRATION_PLAN,
  PACKAGE_REMOVE_PLAN,
  PACKAGE_SYNC_CHECK_PLAN,
  PACKAGE_SYNC_PLAN,
} from '@/core/agent-packages/operation-plans'
import { findAgentPackage, readLockfile } from '@bakin/core/agent-packages/lockfile'
import { parseJsonBodyWeb } from '@/core/middleware'
import { createLogger } from '@/core/logger'
import { startOperationResponse } from '../operations'

const log = createLogger('api:agent-packages:dynamic')

/** The body each route answered before #895 — now the operation's `result`. */
type RouteBody = Record<string, unknown>

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
    return handleMigrate(req)
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
  if (!parsed.success) return invalid(parsed.error.issues)
  const { keepBlocks, deleteAgent, force } = parsed.data ?? {}

  return startOperationResponse<RouteBody>({
    kind: 'remove',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `Remove ${packageId}`,
    href: `/team/${encodeURIComponent(agentId)}`,
    fingerprint: `agent-packages:remove:${packageId}|${deleteAgent ? 'delete-agent' : ''}`,
    resources: ['install-state'],
    plan: PACKAGE_REMOVE_PLAN,
    validate: () => {
      if (!resolvePackageIdForAgent(agentId)) {
        throw new OperationRejectedError(404, { ok: false, error: `No package installed for agent "${agentId}".` })
      }
    },
    run: async (op) => {
      try {
        const result = await removePackageById({ packageId, keepBlocks, deleteAgent, force, op })
        return responseOutcome(200, { ok: true, result })
      } catch (err) {
        if (err instanceof OperationCancelledError) throw err
        log.error('agents/remove failed', err as Error, { packageId })
        const status = err instanceof PackageStillRequiredError ? 409 : 500
        return responseOutcome(status, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  })
}

async function handleSync(req: Request, agentId: string): Promise<Response> {
  // Lenient parse — empty/invalid body means "no options".
  const raw = await parseJsonBodyWeb(req) ?? {}
  const parsed = SyncBodySchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error.issues)
  const check = parsed.data?.check === true
  const reclaim = parsed.data?.reclaim

  return startOperationResponse<RouteBody>({
    kind: 'sync',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `${check ? 'Check' : 'Sync'} ${agentId}`,
    href: `/team/${encodeURIComponent(agentId)}`,
    fingerprint: `agent-packages:sync:${agentId}|${check ? 'check' : ''}|${JSON.stringify(reclaim ?? null)}`,
    // A check is read-only: it holds nothing and never waits on an install.
    resources: check ? [] : ['install-state'],
    plan: check ? PACKAGE_SYNC_CHECK_PLAN : PACKAGE_SYNC_PLAN,
    run: async (op) => {
      try {
        const receipt = await syncAgent(agentId, { check, reclaim, trigger: 'rest', op })
        if (!check) await reloadAgentPackageRegistries({ kind: 'synced', agentId })
        // A check whose upstream question went unanswered is a FAILED check (review r6 #1) — never a quiet 200 "unchanged".
        if (check && receipt.package?.checkError) return responseOutcome(502, { ok: false, error: receipt.package.checkError, receipt }, 'check_failed')
        return responseOutcome(200, { ok: true, receipt })
      } catch (err) {
        if (err instanceof OperationCancelledError) throw err
        if (err instanceof MigrationRequiredError) {
          return responseOutcome(409, { ok: false, migrationRequired: true, error: err.message }, 'migration_required')
        }
        log.error('agents/sync failed', err as Error, { agentId })
        return responseOutcome(500, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  })
}

async function handleMigrate(req: Request): Promise<Response> {
  return startOperationResponse<RouteBody>({
    kind: 'migrate',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: 'Migrate agent workspaces to managed blocks',
    href: '/team',
    fingerprint: 'agent-packages:migrate',
    // Acquired before the first read, so rewrite → ledger → sync run under one owner.
    resources: ['install-state'],
    plan: MIGRATION_PLAN,
    run: async (op) => {
      try {
        const result = await migrateToManagedBlocks({ trigger: 'rest', op })
        if (!result.alreadyMigrated) await reloadAgentPackageRegistries({ kind: 'migrated' })
        return responseOutcome(200, { ok: true, result })
      } catch (err) {
        if (err instanceof OperationCancelledError) throw err
        log.error('agents/migrate failed', err as Error)
        return responseOutcome(500, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  })
}

function invalid(issues: z.ZodIssue[]): Response {
  return Response.json(
    { ok: false, error: issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
    { status: 400 },
  )
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
    if (err instanceof ResourceBusyError) {
      return Response.json({
        ok: false,
        error: 'install_busy',
        message: err.message,
        holder: { title: err.holder.title, operationId: err.holder.operationId },
      }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('agents/lessons/toggle failed', err as Error, { packageId, lessonId })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
