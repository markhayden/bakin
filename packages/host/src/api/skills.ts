/**
 * /api/skills — hub-skill install surface (#687).
 *
 *   GET  /api/skills          — managed skill-packs (hub + catalog) joined with
 *                               unmanaged runtime skills, one honest view
 *   POST /api/skills/preview  — { ref } → trust-gate preview + consent token
 *   POST /api/skills/install  — { ref, consentToken } → token-validated install
 *                               (drift bounces to a fresh preview)
 *
 * Thin doors over src/core/agent-packages/skill-trust — the CLI and the
 * Explore paste box share these exactly. Removal rides the existing
 * DELETE /api/packages/{lockKey} route.
 *
 * Preview, install and map preview are operations (#895): only the body is
 * validated synchronously; the trust assessment (hub verdict, scan) runs
 * inside the operation before any mutation and still fails closed, a refusal
 * ending as a failed outcome carrying today's 403 body. Map apply is bounded
 * and synchronous, taking install-state without waiting (409 install_busy).
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { readLockfile } from '@bakin/core/agent-packages/lockfile'
import { safeParseManifest } from '@bakin/core/agent-packages/manifest'
import { getPackageSourceDir } from '@bakin/core/agent-packages/package-paths'
import { ResourceBusyError, holdNow, operationOriginFromRequest, responseOutcome } from '@bakin/core/operations'
import { buildSkillPreview, confirmSkillInstall } from '@/core/agent-packages/skill-trust'
import { SKILL_INSTALL_PLAN, SKILL_MAP_PLAN, SKILL_PREVIEW_PLAN, SKILL_STAGES } from '@/core/agent-packages/operation-plans'
import { applyMapping, buildMappingPreview } from '@/core/agent-packages/skill-mapping'
import { getAppServices } from '@/core/app-services'
import { getContentDir } from '@/core/content-dir'
import { parseJsonBodyWeb } from '@/core/middleware'
import { createLogger } from '@/core/logger'
import { startOperationResponse } from './operations'

const log = createLogger('api:skills')

/** The body each route answered before #895 — now the operation's `result`. */
type RouteBody = Record<string, unknown>

const RefBodySchema = z.object({ ref: z.string().min(1).max(2048) })
const InstallBodySchema = RefBodySchema.extend({ consentToken: z.string().min(1).max(8192) })

export interface ManagedSkillRow {
  skillName: string
  packageId: string
  version: string
  source: string
  hub: boolean
  upstream?: { source: string; ref?: string; resolvedSha?: string }
  capability?: string
}

export interface UnmanagedSkillRow {
  name: string
  scope: string
}

export async function get(): Promise<Response> {
  const lock = readLockfile()
  const managed: ManagedSkillRow[] = []
  const managedNames = new Set<string>()

  for (const [key, entry] of Object.entries(lock.packages)) {
    if (entry.kind !== 'skill-pack') continue
    const id = key.includes('@') ? key.slice(0, key.lastIndexOf('@')) : key
    const manifestPath = join(getPackageSourceDir(getContentDir(), entry.kind, id, entry.version), 'bakin-package.json')
    let upstream: ManagedSkillRow['upstream']
    let capability: string | undefined
    if (existsSync(manifestPath)) {
      try {
        const parsed = safeParseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
        if (parsed.success && parsed.data.kind === 'skill-pack') {
          upstream = parsed.data.upstream
          capability = parsed.data.capability
        }
      } catch (err) {
        log.warn('Installed manifest unreadable for skills list', { key, error: err instanceof Error ? err.message : String(err) })
      }
    }
    for (const projection of entry.projections ?? []) {
      if (projection.kind !== 'skill' || !projection.target.startsWith('runtime:global-skill:')) continue
      const skillName = decodeURIComponent(projection.target.slice('runtime:global-skill:'.length))
      managedNames.add(skillName)
      managed.push({
        skillName,
        packageId: key,
        version: entry.version,
        source: entry.source,
        hub: upstream !== undefined,
        ...(upstream ? { upstream } : {}),
        ...(capability ? { capability } : {}),
      })
    }
  }

  const unmanaged: UnmanagedSkillRow[] = []
  try {
    const runtimeSkills = await getAppServices().runtime.skills.list()
    for (const skill of runtimeSkills) {
      if (managedNames.has(skill.name) || skill.metadata?.installedBy) continue
      unmanaged.push({ name: skill.name, scope: String(skill.metadata?.scope ?? 'global') })
    }
  } catch (err) {
    log.warn('Runtime skills unavailable for skills list', { error: err instanceof Error ? err.message : String(err) })
  }

  managed.sort((a, b) => a.skillName.localeCompare(b.skillName))
  unmanaged.sort((a, b) => a.name.localeCompare(b.name))
  return Response.json({ managed, unmanaged })
}

export async function preview(req: Request): Promise<Response> {
  const parsed = RefBodySchema.safeParse(await parseJsonBodyWeb(req))
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const { ref } = parsed.data
  return startOperationResponse<RouteBody>({
    kind: 'fetch',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `Preview ${ref}`,
    href: '/explore',
    fingerprint: `skills:preview:${ref}`,
    resources: [],
    plan: SKILL_PREVIEW_PLAN,
    run: async (op) => {
      const result = await buildSkillPreview(ref, op)
      if (!result.ok) {
        return responseOutcome(result.refused ? 403 : 400, { ok: false, refused: result.refused, error: result.error }, result.refused ? 'refused' : undefined)
      }
      return responseOutcome(200, { ok: true, preview: result.preview })
    },
  })
}

const MapPreviewBodySchema = z.object({ name: z.string().min(1).max(128) })
const MapApplyBodySchema = z.object({
  name: z.string().min(1).max(128),
  mapping: z.object({
    addSecrets: z.array(z.object({ name: z.string(), secretSlot: z.string(), help: z.string().optional() })),
    addPrereqs: z.array(z.object({ name: z.string(), kind: z.literal('binary'), probe: z.string(), help: z.string(), optional: z.boolean() })),
    platforms: z.array(z.string()).optional(),
    dropped: z.array(z.object({ name: z.string(), reason: z.string() })),
    notes: z.string().optional(),
  }),
})

/** POST /api/skills/map/preview — run the mapping turn (an operation), return the verified diff. */
export async function mapPreview(req: Request): Promise<Response> {
  const parsed = MapPreviewBodySchema.safeParse(await parseJsonBodyWeb(req))
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const { name } = parsed.data
  return startOperationResponse<RouteBody>({
    kind: 'skill-map',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `Map ${name}'s requirements`,
    href: '/explore',
    fingerprint: `skills:map:${name}`,
    resources: [],
    plan: SKILL_MAP_PLAN,
    run: async (op) => {
      op.stage(SKILL_STAGES.map, name)
      const result = await buildMappingPreview(name)
      if (!result.ok) {
        // not-found is the caller's mistake; a failed mapping turn is ours.
        if (result.reason === 'turn-failed') {
          log.error('skill mapping turn failed', new Error(result.error), { name })
          return responseOutcome(502, { ok: false, error: result.error })
        }
        return responseOutcome(400, { ok: false, error: result.error })
      }
      return responseOutcome(200, { ok: true, preview: result.preview })
    },
  })
}

/**
 * POST /api/skills/map/apply — re-verify + amend the installed manifest.
 * Bounded and local: install-state is taken without waiting.
 */
export async function mapApply(req: Request): Promise<Response> {
  const parsed = MapApplyBodySchema.safeParse(await parseJsonBodyWeb(req))
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  try {
    const result = await holdNow(['install-state'], { title: `Apply the ${parsed.data.name} mapping` }, async () => applyMapping(parsed.data.name, parsed.data.mapping))
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 })
    return Response.json({ ok: true, applied: result.applied })
  } catch (err) {
    if (err instanceof ResourceBusyError) {
      return Response.json({
        ok: false,
        error: 'install_busy',
        message: err.message,
        holder: { title: err.holder.title, operationId: err.holder.operationId },
      }, { status: 409 })
    }
    throw err
  }
}

export async function install(req: Request): Promise<Response> {
  const parsed = InstallBodySchema.safeParse(await parseJsonBodyWeb(req))
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const { ref, consentToken } = parsed.data
  return startOperationResponse<RouteBody>({
    kind: 'install',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `Install ${ref}`,
    href: '/explore',
    fingerprint: `skills:install:${ref}|${consentToken.slice(0, 24)}`,
    resources: ['install-state'],
    plan: SKILL_INSTALL_PLAN,
    run: async (op) => {
      const result = await confirmSkillInstall(ref, consentToken, op)
      switch (result.status) {
        case 'installed':
          return responseOutcome(200, { ok: true, installed: result.result, warnings: result.warnings })
        case 'drift':
          return responseOutcome(200, { ok: false, drift: true, preview: result.preview }, 'drift')
        case 'invalid-token':
          return responseOutcome(400, { ok: false, error: result.error })
        case 'refused':
          return responseOutcome(403, { ok: false, refused: true, error: result.error }, 'refused')
        case 'error':
          // The gate already logged the stack; this keeps the 5xx traceable to a
          // request per the house rule that every 5xx logs server-side.
          log.error('skill install returned an error', new Error(result.error), { ref })
          return responseOutcome(500, { ok: false, error: result.error })
      }
    },
  })
}
