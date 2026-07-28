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
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { readLockfile } from '@bakin/core/agent-packages/lockfile'
import { safeParseManifest } from '@bakin/core/agent-packages/manifest'
import { getPackageSourceDir } from '@bakin/core/agent-packages/package-paths'
import { buildSkillPreview, confirmSkillInstall } from '@/core/agent-packages/skill-trust'
import { applyMapping, buildMappingPreview } from '@/core/agent-packages/skill-mapping'
import { getAppServices } from '@/core/app-services'
import { getContentDir } from '@/core/content-dir'
import { parseJsonBodyWeb } from '@/core/middleware'
import { createLogger } from '@/core/logger'

const log = createLogger('api:skills')

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

export async function get(_req: Request, _url: URL): Promise<Response> {
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

export async function preview(req: Request, _url: URL): Promise<Response> {
  const parsed = RefBodySchema.safeParse(await parseJsonBodyWeb(req))
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const result = await buildSkillPreview(parsed.data.ref)
  if (!result.ok) {
    return Response.json(
      { ok: false, refused: result.refused, error: result.error },
      { status: result.refused ? 403 : 400 },
    )
  }
  return Response.json({ ok: true, preview: result.preview })
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

/** POST /api/skills/map/preview — run the mapping turn, return the verified diff. */
export async function mapPreview(req: Request, _url: URL): Promise<Response> {
  const parsed = MapPreviewBodySchema.safeParse(await parseJsonBodyWeb(req))
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const result = await buildMappingPreview(parsed.data.name)
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 })
  return Response.json({ ok: true, preview: result.preview })
}

/** POST /api/skills/map/apply — re-verify + amend the installed manifest. */
export async function mapApply(req: Request, _url: URL): Promise<Response> {
  const parsed = MapApplyBodySchema.safeParse(await parseJsonBodyWeb(req))
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const result = applyMapping(parsed.data.name, parsed.data.mapping)
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 })
  return Response.json({ ok: true, applied: result.applied })
}

export async function install(req: Request, _url: URL): Promise<Response> {
  const parsed = InstallBodySchema.safeParse(await parseJsonBodyWeb(req))
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const result = await confirmSkillInstall(parsed.data.ref, parsed.data.consentToken)
  switch (result.status) {
    case 'installed':
      return Response.json({ ok: true, installed: result.result, warnings: result.warnings })
    case 'drift':
      return Response.json({ ok: false, drift: true, preview: result.preview })
    case 'invalid-token':
      return Response.json({ ok: false, error: result.error }, { status: 400 })
    case 'refused':
      return Response.json({ ok: false, refused: true, error: result.error }, { status: 403 })
    case 'error':
      return Response.json({ ok: false, error: result.error }, { status: 500 })
  }
}
