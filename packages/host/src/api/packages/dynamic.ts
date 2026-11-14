/**
 * Dispatcher for /api/packages/{packageId}/* routes (standalone packs).
 *
 *   DELETE /api/packages/{packageId}                  remove (refuses w/ refCount > 0)
 *   POST   /api/packages/{packageId}/sync             fetch + re-project at recorded ref
 *
 * The packageId here is the lockfile key — for standalone packs that's
 * `<id>@<version>` (e.g. "markhayden.bakin-skills-visual@0.3.1"). The CLI
 * URL-encodes the `@` so the path-segment match below works without
 * extra parsing.
 *
 * Both run as operations (#895): an unknown package is still a synchronous
 * 404; everything else answers 202 `{ operationId, bootId }` and the body
 * these routes used to answer is the operation's `result`.
 */
import { z } from 'zod'
import {
  OperationCancelledError,
  OperationRejectedError,
  operationOriginFromRequest,
  responseOutcome,
  type OperationOrigin,
  type StartOperationInput,
} from '@bakin/core/operations'
import { readLockfile } from '@bakin/core/agent-packages/lockfile'
import { PackageNotInstalledError, PackageStillRequiredError } from '@/core/agent-packages/errors'
import { removePackageById } from '@/core/agent-packages/uninstaller'
import { syncPack } from '@/core/agent-packages/sync'
import { reloadAgentPackageRegistries } from '@/core/agent-packages/post-sync-reload'
import { PACKAGE_REMOVE_PLAN, PACKAGE_SYNC_CHECK_PLAN, PACKAGE_SYNC_PLAN } from '@/core/agent-packages/operation-plans'
import { parseJsonBodyWeb } from '@/core/middleware'
import { createLogger } from '@/core/logger'
import { startOperationResponse } from '../operations'

const log = createLogger('api:packages:dynamic')

/** The body each route answered before #895 — now the operation's `result`. */
type RouteBody = Record<string, unknown>

const RemoveBodySchema = z
  .object({
    keepBlocks: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .optional()
  .default({})

const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/i)
const SyncBodySchema = z
  .object({
    check: z.boolean().optional(),
    /** Fetch exactly this commit (self-healing 1.2; the updates apply lane binds the reviewed identity). */
    expected: z.object({ sha: ShaSchema }).optional(),
    /** Re-stage from upstream even at the same commit (the repair for an unreadable installed manifest). */
    reinstall: z.boolean().optional(),
  })
  .optional()
  .default({})

export interface PackageSyncOptions {
  check?: boolean
  expected?: { sha: string }
  reinstall?: boolean
}

/**
 * The pack sync as an operation — the SAME input the route starts, exported
 * for the updates apply service and the Health repair actions (plan 1.2;
 * model: `pluginUpgradeOperation`). A pinned or reinstalling sync is its own
 * identity: it never attaches to an ordinary sync already running.
 */
export function packageSyncOperation(packageId: string, options: PackageSyncOptions, origin: OperationOrigin): StartOperationInput<RouteBody> {
  const check = options.check === true
  const pin = options.expected?.sha ?? ''
  return {
    kind: 'sync',
    owner: 'core',
    origin,
    title: `${check ? 'Check' : options.reinstall ? 'Reinstall' : 'Sync'} ${packageId}`,
    href: '/explore',
    fingerprint: `packages:sync:${packageId}|${check ? 'check' : ''}|${pin}|${options.reinstall ? 'reinstall' : ''}`,
    // A check is read-only: it holds nothing and never waits on an install.
    resources: check ? [] : ['install-state'],
    plan: check ? PACKAGE_SYNC_CHECK_PLAN : PACKAGE_SYNC_PLAN,
    validate: () => requireInstalled(packageId),
    run: async (op) => {
      try {
        const receipt = await syncPack(packageId, { check, op, ...(options.expected ? { expected: options.expected } : {}), ...(options.reinstall ? { reinstall: true } : {}) })
        if (!check && receipt.changed) await reloadAgentPackageRegistries({ kind: 'synced' })
        return responseOutcome(200, { ok: true, receipt })
      } catch (err) {
        if (err instanceof OperationCancelledError) throw err
        log.error('packages/sync failed', err as Error, { packageId })
        const status = err instanceof PackageNotInstalledError ? 404 : 500
        return responseOutcome(status, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  }
}

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
  if (segments.length === 4 && segments[3] === 'sync' && req.method === 'POST') {
    return handleSync(req, packageId)
  }

  return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
}

function invalid(issues: z.ZodIssue[]): Response {
  return Response.json(
    { ok: false, error: issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
    { status: 400 },
  )
}

/** Synchronous 404 for a package that is not installed — no operation is created. */
function requireInstalled(packageId: string): void {
  if (!readLockfile().packages[packageId]) {
    throw new OperationRejectedError(404, { ok: false, error: new PackageNotInstalledError(packageId).message })
  }
}

async function handleRemove(req: Request, packageId: string): Promise<Response> {
  // Lenient parse — empty/invalid body means "no options".
  const raw = await parseJsonBodyWeb(req) ?? {}
  const parsed = RemoveBodySchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error.issues)
  const { keepBlocks, force } = parsed.data ?? {}

  return startOperationResponse<RouteBody>({
    kind: 'remove',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `Remove ${packageId}`,
    href: '/explore',
    fingerprint: `packages:remove:${packageId}`,
    resources: ['install-state'],
    plan: PACKAGE_REMOVE_PLAN,
    validate: () => requireInstalled(packageId),
    run: async (op) => {
      try {
        const result = await removePackageById({ packageId, keepBlocks, force, op })
        return responseOutcome(200, { ok: true, result })
      } catch (err) {
        if (err instanceof OperationCancelledError) throw err
        log.error('packages/remove failed', err as Error, { packageId })
        const status = err instanceof PackageStillRequiredError ? 409 : err instanceof PackageNotInstalledError ? 404 : 500
        return responseOutcome(status, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  })
}

async function handleSync(req: Request, packageId: string): Promise<Response> {
  // Lenient parse — empty/invalid body means "no options".
  const raw = await parseJsonBodyWeb(req) ?? {}
  const parsed = SyncBodySchema.safeParse(raw)
  if (!parsed.success) return invalid(parsed.error.issues)
  return startOperationResponse<RouteBody>(packageSyncOperation(packageId, parsed.data ?? {}, operationOriginFromRequest(req)))
}
