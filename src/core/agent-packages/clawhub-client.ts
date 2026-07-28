/**
 * Minimal ClawHub client (#687, D9) — the WHOLE integration.
 *
 * Consumes exactly four read endpoints (verified live 2026-07-27, shapes
 * pinned in .claude/specs/skill-hub-interop/API-NOTES.md), all anonymous:
 *
 *   GET /api/v1/skills/{slug}[?owner=]                    — detail / disambiguation
 *   GET /api/v1/skills/{slug}/versions[?owner=]           — version list (latest resolution)
 *   GET /api/v1/skills/{slug}/versions/{v}[?owner=]       — per-file sha256 manifest + security verdict
 *   GET /api/v1/skills/{slug}/file?path=[&owner=&version=] — individual file content
 *
 * Files are fetched individually and verified against their pinned sha256 —
 * no archives, no zip attack surface. Zod schemas pin ONLY consumed fields
 * (.passthrough()); unrecognized VERDICT semantics fail closed (D5), while
 * endpoint unreachability is an honest 'unverified' the trust gate surfaces.
 *
 * Raw fetch only — no hub SDK dependency, ever (adapter rule).
 */
import { createHash } from 'crypto'
import { z } from 'zod'
import { createLogger } from '../logger'

const log = createLogger('clawhub')

export const CLAWHUB_BASE_URL = 'https://clawhub.ai'

export type ClawhubFetcher = (url: string) => Promise<Response>

export interface ClawhubClientOptions {
  baseUrl?: string
  fetcher?: ClawhubFetcher
}

// ─── Consumed response shapes (observed, not documented) ─────────────────────

const MatchSchema = z.object({
  ownerHandle: z.string(),
  slug: z.string(),
  ref: z.string().optional(),
  url: z.string().optional(),
}).passthrough()

const AmbiguousSchema = z.object({
  code: z.literal('AMBIGUOUS_SKILL_SLUG'),
  matches: z.array(MatchSchema).min(1),
}).passthrough()

const DetailSchema = z.object({
  skill: z.object({
    slug: z.string(),
    displayName: z.string().optional(),
    summary: z.string().nullish(),
    stats: z.object({
      downloads: z.number().optional(),
      installs: z.number().optional(),
      stars: z.number().optional(),
    }).passthrough().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  }).passthrough(),
  latestVersion: z.object({ version: z.string() }).passthrough().nullish(),
}).passthrough()

const VersionsSchema = z.object({
  items: z.array(z.object({ version: z.string() }).passthrough()),
}).passthrough()

const FileEntrySchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  contentType: z.string().optional(),
}).passthrough()

const SecuritySchema = z.object({
  status: z.string(),
  hasWarnings: z.boolean().optional(),
  sha256hash: z.string().optional(),
  scanners: z.record(z.string(), z.object({
    status: z.string().nullish(),
    recommendation: z.string().nullish(),
    summary: z.string().nullish(),
  }).passthrough()).optional(),
}).passthrough()

const VersionDetailSchema = z.object({
  version: z.object({
    version: z.string(),
    files: z.array(FileEntrySchema).min(1),
    security: SecuritySchema.nullish(),
    license: z.string().nullish(),
    changelog: z.string().nullish(),
  }).passthrough(),
}).passthrough()

const ScanSchema = z.object({
  moderation: z.object({
    isPendingScan: z.boolean().optional(),
    isMalwareBlocked: z.boolean().optional(),
    isSuspicious: z.boolean().optional(),
    isHiddenByMod: z.boolean().optional(),
    isRemoved: z.boolean().optional(),
  }).passthrough().nullish(),
  security: SecuritySchema.nullish(),
}).passthrough()

export type ClawhubSkillDetail = z.infer<typeof DetailSchema>
export type ClawhubVersionDetail = z.infer<typeof VersionDetailSchema>
export type ClawhubScan = z.infer<typeof ScanSchema>
export type ClawhubMatch = z.infer<typeof MatchSchema>

/** Thrown when a bare slug has multiple publishers — surfaces the owner picker. */
export class AmbiguousClawhubSlugError extends Error {
  constructor(public readonly slug: string, public readonly matches: ClawhubMatch[]) {
    super(
      `Multiple publishers use the slug "${slug}" on ClawHub. Pick one:\n` +
        matches.map((m) => `  clawhub:@${m.ownerHandle}/${m.slug}`).join('\n'),
    )
    this.name = 'AmbiguousClawhubSlugError'
  }
}

/**
 * The verdict summary the trust gate consumes. `refused` carries the hard
 * refusal reasons (D5 — no override exists); `warnings` ride to the consent
 * preview; `state` label feeds honest UI copy.
 */
export interface ClawhubVerdict {
  state: 'clean' | 'refused' | 'unverified'
  refusals: string[]
  warnings: string[]
}

/**
 * D5 gate policy over the observed moderation/security shapes. Fail-closed:
 * a present-but-unrecognized security payload REFUSES; only endpoint
 * unreachability earns 'unverified'.
 */
export function evaluateVerdict(scan: ClawhubScan | null, versionSecurity: z.infer<typeof SecuritySchema> | null | undefined): ClawhubVerdict {
  if (scan === null && (versionSecurity === null || versionSecurity === undefined)) {
    return { state: 'unverified', refusals: [], warnings: ['ClawHub security verdict unavailable — hub unreachable. Content is unverified.'] }
  }
  const refusals: string[] = []
  const warnings: string[] = []

  const moderation = scan?.moderation
  if (moderation) {
    if (moderation.isMalwareBlocked) refusals.push('ClawHub has blocked this skill as malware')
    if (moderation.isSuspicious) refusals.push('ClawHub moderation marks this skill suspicious')
    if (moderation.isHiddenByMod) refusals.push('ClawHub moderators have hidden this skill')
    if (moderation.isRemoved) refusals.push('this skill has been removed from ClawHub')
    if (moderation.isPendingScan) warnings.push('ClawHub has not finished scanning this version yet')
  }

  for (const security of [scan?.security, versionSecurity]) {
    if (security === null || security === undefined) continue
    const status = security.status.toLowerCase()
    if (status === 'suspicious' || status === 'malicious') {
      refusals.push(`ClawHub security scan verdict: ${status}`)
    } else if (status !== 'clean' && status !== 'pending' && status !== 'unscanned') {
      // Fail closed on semantics we don't recognize.
      refusals.push(`ClawHub reports an unrecognized security status "${security.status}" — refusing (fail closed)`)
    }
    for (const [name, scanner] of Object.entries(security.scanners ?? {})) {
      if (scanner.recommendation === 'DO_NOT_INSTALL') {
        refusals.push(`ClawHub scanner "${name}" recommends DO_NOT_INSTALL${scanner.summary ? `: ${scanner.summary}` : ''}`)
      }
    }
    if (security.hasWarnings && refusals.length === 0) {
      warnings.push('ClawHub security scan reports warnings — review the preview carefully')
    }
  }

  const deduped = [...new Set(refusals)]
  return deduped.length > 0
    ? { state: 'refused', refusals: deduped, warnings }
    : { state: 'clean', refusals: [], warnings }
}

// ─── Client ──────────────────────────────────────────────────────────────────

export interface ClawhubClient {
  getDetail(slug: string, owner?: string): Promise<ClawhubSkillDetail>
  resolveLatestVersion(slug: string, owner?: string): Promise<string>
  getVersionDetail(slug: string, version: string, owner?: string): Promise<ClawhubVersionDetail>
  /** null = unreachable (honest 'unverified'); parse failures THROW (fail closed). */
  getScan(slug: string, owner?: string): Promise<ClawhubScan | null>
  getFileBytes(slug: string, path: string, opts: { owner?: string; version?: string }): Promise<Uint8Array>
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function createClawhubClient(options: ClawhubClientOptions = {}): ClawhubClient {
  const base = (options.baseUrl ?? CLAWHUB_BASE_URL).replace(/\/+$/, '')
  const fetcher: ClawhubFetcher = options.fetcher ?? ((url) => fetch(url, { headers: { 'user-agent': 'bakin' } }))

  const skillUrl = (slug: string, suffix: string, params: Record<string, string | undefined>): string => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, value)
    }
    const query = search.toString()
    return `${base}/api/v1/skills/${encodeURIComponent(slug)}${suffix}${query ? `?${query}` : ''}`
  }

  const getJson = async (url: string): Promise<unknown> => {
    const response = await fetcher(url)
    const text = await response.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    if (body !== null && typeof body === 'object') {
      const ambiguous = AmbiguousSchema.safeParse(body)
      if (ambiguous.success) {
        const slug = (body as { slug?: string }).slug ?? 'unknown'
        throw new AmbiguousClawhubSlugError(slug, ambiguous.data.matches)
      }
    }
    if (!response.ok) {
      throw new Error(`ClawHub request failed (${response.status}): ${text.slice(0, 200)}`)
    }
    if (body === null) throw new Error(`ClawHub returned non-JSON from ${url}`)
    return body
  }

  return {
    async getDetail(slug, owner) {
      const body = await getJson(skillUrl(slug, '', { owner }))
      const parsed = DetailSchema.safeParse(body)
      if (!parsed.success) throw new Error(`ClawHub skill detail did not match the consumed shape: ${parsed.error.issues[0]?.message}`)
      return parsed.data
    },

    async resolveLatestVersion(slug, owner) {
      const detail = await this.getDetail(slug, owner)
      const tagged = detail.skill.tags?.latest ?? detail.latestVersion?.version
      if (tagged) return tagged
      const versions = VersionsSchema.safeParse(await getJson(skillUrl(slug, '/versions', { owner })))
      const first = versions.success ? versions.data.items[0]?.version : undefined
      if (!first) throw new Error(`ClawHub lists no versions for "${slug}"`)
      return first
    },

    async getVersionDetail(slug, version, owner) {
      const body = await getJson(skillUrl(slug, `/versions/${encodeURIComponent(version)}`, { owner }))
      const parsed = VersionDetailSchema.safeParse(body)
      if (!parsed.success) throw new Error(`ClawHub version detail did not match the consumed shape: ${parsed.error.issues[0]?.message}`)
      return parsed.data
    },

    async getScan(slug, owner) {
      let body: unknown
      try {
        body = await getJson(skillUrl(slug, '/scan', { owner }))
      } catch (err) {
        if (err instanceof AmbiguousClawhubSlugError) throw err
        log.warn('ClawHub scan endpoint unreachable — verdict is unverified', {
          slug, error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
      const parsed = ScanSchema.safeParse(body)
      // Reachable but unrecognized → FAIL CLOSED (D5), not 'unverified'.
      if (!parsed.success) throw new Error(`ClawHub scan response did not match the consumed shape — refusing (fail closed)`)
      return parsed.data
    },

    async getFileBytes(slug, path, opts) {
      const url = skillUrl(slug, '/file', { path, owner: opts.owner, version: opts.version })
      const response = await fetcher(url)
      if (!response.ok) throw new Error(`ClawHub file download failed (${response.status}) for "${path}"`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
