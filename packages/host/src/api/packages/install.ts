/**
 * POST /api/packages/install
 *
 * Installs a standalone skill-pack / workflow-pack / lesson-pack.
 * Same body shape as /api/agents/install minus `adopt` (only agent
 * packages have a runtime-agent counterpart that adoption attaches to).
 *
 * A bare `source` (no github:/path prefix) resolves BY NAME from the curated
 * catalog (official entries, ref-pinned via sourceWithRef) — the shared
 * resolution behind `bakin packages install web-search-brave` and the
 * Explore install button. Successful capability-pack installs carry the
 * pack's readiness (`capability`) so clients can run the guided key step.
 *
 * Runs as an operation (#895): 202 `{ operationId, bootId }` at once; the
 * body this route used to answer is the operation's `result`.
 */
import { z } from 'zod'
import { OperationCancelledError, operationOriginFromRequest, responseOutcome, type OperationContext } from '@bakin/core/operations'
import { installPackage } from '@/core/agent-packages/installer'
import { PACKAGE_INSTALL_PLAN } from '@/core/agent-packages/operation-plans'
import { listCapabilities, type CapabilityReadiness } from '@/core/agent-packages/capability-readiness'
import { loadUnifiedCatalog } from '@/core/curated-catalog/load'
import { sourceWithRef } from '@/lib/package-source'
import { createLogger } from '@/core/logger'
import { startOperationResponse } from '../operations'

const log = createLogger('api:packages:install')

const InstallBodySchema = z.object({
  source: z.string().min(1),
  type: z.enum(['local', 'github']).optional(),
  replace: z.boolean().optional(),
  installAs: z.string().regex(/^[a-z0-9][a-z0-9-_]{0,39}$/i, { message: 'installAs must be a package id (no slashes)' }).optional(),
})

function isBareName(source: string): boolean {
  return !source.includes(':') && !source.startsWith('./') && !source.startsWith('../')
    && !source.startsWith('/') && !source.startsWith('~/')
}

async function resolveCatalogSource(name: string): Promise<{ source: string } | { error: string }> {
  const catalog = await loadUnifiedCatalog()
  const entry = catalog.entries.find(
    (e) => e.id === name && (e.kind === 'skill-pack' || e.kind === 'workflow-pack' || e.kind === 'lesson-pack'),
  )
  if (!entry?.source) {
    return { error: `No pack named "${name}" in the curated catalog — pass a github:user/repo or local path source.` }
  }
  return { source: sourceWithRef(entry.source, entry.ref) }
}

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
      {
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
      { status: 400 },
    )
  }

  let source = parsed.data.source
  if (isBareName(source)) {
    const resolved = await resolveCatalogSource(source)
    if ('error' in resolved) return Response.json({ ok: false, error: resolved.error }, { status: 404 })
    source = resolved.source
  }

  const { replace, installAs } = parsed.data
  return startOperationResponse({
    kind: 'install',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `Install ${installAs ?? source}`,
    href: '/explore',
    fingerprint: `packages:install:${source}|${installAs ?? ''}|${replace ? 'replace' : ''}`,
    resources: ['install-state'],
    plan: PACKAGE_INSTALL_PLAN,
    run: async (op) => {
      const { status, body } = await runPackageInstall(source, parsed.data, op)
      return responseOutcome(status, body)
    },
  })
}

async function runPackageInstall(
  source: string,
  data: { replace?: boolean; installAs?: string },
  op: OperationContext,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const result = await installPackage({
      source,
      replace: data.replace,
      installAs: data.installAs,
      op,
    })
    if (result.kind === 'agent') {
      // Agent packages must go through /api/agents/install — the surfaces
      // are deliberately separate so the adopt path lives in one place.
      return {
        status: 400,
        body: { ok: false, error: 'Source is an agent package — use POST /api/agent-packages/install instead.' },
      }
    }
    // Capability packs: attach readiness so the client can run the guided
    // key step and print honest per-leg status.
    let capability: CapabilityReadiness | undefined
    try {
      capability = (await listCapabilities()).find((c) => c.packageId === result.packageId)
    } catch (err) {
      log.warn('capability readiness after install failed', { error: err instanceof Error ? err.message : String(err) })
    }
    return { status: 200, body: { ok: true, resolvedSource: source, result, ...(capability ? { capability } : {}) } }
  } catch (err) {
    if (err instanceof OperationCancelledError) throw err
    const message = err instanceof Error ? err.message : String(err)
    log.error('packages/install failed', err as Error, { source })
    const isConflict = /already managed|collision/i.test(message)
    return { status: isConflict ? 409 : 500, body: { ok: false, error: message } }
  }
}
