/**
 * Shared agent-avatar resolver — the single source of truth for how Bakin
 * locates, types, and serves per-agent avatar files (#339).
 *
 * Both consumers (the team plugin's discovery/serve/upload routes and the host
 * `GET /api/agents/avatar` route) go through here, so the supported formats and
 * the format→MIME mapping live in exactly one place. The MIME map itself is
 * reused from `media/image-format` (the #380 consolidation) — this module never
 * re-declares mime strings; it only owns the avatar-specific priority order and
 * the magic-byte sniffing the pure image-format module can't do.
 */
import { statSync, readFileSync } from 'fs'
import { join } from 'path'
import { getBakinPaths } from '../content-dir'
import { createLogger } from '../logger'
import { IMAGE_EXTENSION_TO_MIME } from '../media/image-format'
import { loadSharp } from '../media/sharp-loader'
import { atomicWriteBytes, atomicWriteJson } from '../storage/atomic-write'

const log = createLogger('avatar')

/** Avatar formats in priority order — first existing file wins on read. */
const AVATAR_EXT_PRIORITY = ['webp', 'png', 'jpg'] as const
type AvatarExt = (typeof AVATAR_EXT_PRIORITY)[number]

/**
 * Agent ids are safe slugs — no separators means the join below can never
 * escape the agents root, and a leading alphanumeric rejects `.`/`..`.
 * Centralized here so every avatar entry point shares one guard.
 */
const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** True when `agentId` is a safe slug (no separators, no `.`/`..`). */
export function isValidAgentId(agentId: string): boolean {
  return AGENT_ID_RE.test(agentId)
}

const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400'

export interface ResolvedAvatar {
  path: string
  contentType: string
  size: number
  mtimeMs: number
}

/**
 * Find an agent's avatar on disk, preferring webp → png → jpg. Returns `null`
 * for an invalid id or when no avatar file exists. One `statSync` per probed
 * format; no file contents are read.
 */
export function resolveAgentAvatar(agentId: string): ResolvedAvatar | null {
  if (!isValidAgentId(agentId)) return null
  const { agents } = getBakinPaths()
  for (const ext of AVATAR_EXT_PRIORITY) {
    const path = join(agents, agentId, `avatar.${ext}`)
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    const contentType = IMAGE_EXTENSION_TO_MIME[`.${ext}`] ?? 'application/octet-stream'
    return { path, contentType, size: stat.size, mtimeMs: stat.mtimeMs }
  }
  return null
}

/**
 * Sniff a supported image format from its leading bytes. Returns the bare
 * extension to store, or `null` when the bytes are not a recognized image.
 * Used by the upload path to preserve the uploaded format without trusting a
 * (spoofable, often-absent) Content-Type header.
 */
export function detectImageExtension(buffer: Uint8Array): AvatarExt | null {
  // PNG: 89 50 4E 47
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  ) {
    return 'png'
  }
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg'
  }
  // WebP: 'RIFF' (0–3) .... 'WEBP' (8–11)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'webp'
  }
  return null
}

// ---------------------------------------------------------------------------
// Display variant — avatars render at ≤ 48 CSS px, so a large stored original
// (a 1.9 MB photo on margo) is served as a cached ≤ 256 px WebP instead. The
// original is never modified (uploads and package projections stay exactly
// as stored, so package drift checks still hold).
// ---------------------------------------------------------------------------

/** Sources at or below this size are served as stored. */
const DISPLAY_SOURCE_THRESHOLD = 64 * 1024
const DISPLAY_MAX_EDGE = 256
const DISPLAY_MAX_BYTES = 65_536
/** Encode at the first quality that fits the byte budget. */
const DISPLAY_QUALITIES = [80, 60, 40] as const
/** Bump when the transform changes so cached variants regenerate. */
const DISPLAY_TRANSFORM_VERSION = 1

interface DisplayVariant {
  path: string
  size: number
  mtimeMs: number
}

/** Generations in flight, per agent — concurrent requests share one conversion. */
const displayInFlight = new Map<string, Promise<DisplayVariant | null>>()
/** Source keys whose conversion failed (or did not fit the budget) — not retried until the source changes. */
const displayFailed = new Set<string>()

function displaySourceKey(source: ResolvedAvatar): string {
  return `${source.path}|${source.mtimeMs}|${source.size}|v${DISPLAY_TRANSFORM_VERSION}`
}

function displayPaths(agentId: string): { image: string; meta: string } {
  const dir = join(getBakinPaths().cache, 'avatars')
  return { image: join(dir, `${agentId}.webp`), meta: join(dir, `${agentId}.json`) }
}

function cachedDisplayVariant(agentId: string, key: string): DisplayVariant | null {
  const paths = displayPaths(agentId)
  try {
    const meta = JSON.parse(readFileSync(paths.meta, 'utf-8')) as { sourceKey?: unknown }
    if (meta.sourceKey !== key) return null
    const stat = statSync(paths.image)
    return { path: paths.image, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return null // no (or unreadable) cache entry — generate
  }
}

async function generateDisplayVariant(agentId: string, source: ResolvedAvatar, key: string): Promise<DisplayVariant | null> {
  // Absent sharp is not a failure to remember: the loader re-probes, so a
  // `bakin install media` makes the next request derive without a restart.
  const sharp = await loadSharp()
  if (!sharp) return null
  try {
    let encoded: Buffer | null = null
    for (const quality of DISPLAY_QUALITIES) {
      const out = await sharp(source.path)
        .rotate()
        .resize({ width: DISPLAY_MAX_EDGE, height: DISPLAY_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toBuffer()
      if (out.length <= DISPLAY_MAX_BYTES) {
        encoded = out
        break
      }
    }
    if (!encoded) throw new Error(`no encoding fits ${DISPLAY_MAX_BYTES} bytes`)
    // The source may have been replaced while converting — publish only for
    // the source this conversion read.
    const now = statSync(source.path)
    if (now.mtimeMs !== source.mtimeMs || now.size !== source.size) return null
    const paths = displayPaths(agentId)
    atomicWriteBytes(paths.image, encoded)
    atomicWriteJson(paths.meta, { sourceKey: key })
    const stat = statSync(paths.image)
    return { path: paths.image, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch (err) {
    displayFailed.add(key)
    log.warn('Avatar display variant unavailable; serving the original', {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/** The display variant for a large source, or null to serve the original. */
async function displayVariant(agentId: string, source: ResolvedAvatar): Promise<DisplayVariant | null> {
  if (source.size <= DISPLAY_SOURCE_THRESHOLD) return null
  const key = displaySourceKey(source)
  if (displayFailed.has(key)) return null
  const cached = cachedDisplayVariant(agentId, key)
  if (cached) return cached
  const pending = displayInFlight.get(agentId)
  if (pending) return pending
  const generation = generateDisplayVariant(agentId, source, key).finally(() => displayInFlight.delete(agentId))
  displayInFlight.set(agentId, generation)
  return generation
}

interface AvatarRepresentation {
  path: string
  contentType: string
  size: number
  mtimeMs: number
  /** Validator family — derived and original bytes never share an ETag. */
  etagPrefix: string
}

/** Conditional-GET-aware response for one stored representation. */
function respondWithRepresentation(req: Request, rep: AvatarRepresentation): Response {
  // Truncate mtime to whole seconds so it agrees with the second-precision
  // Last-Modified header during If-Modified-Since comparisons.
  const mtimeSec = Math.floor(rep.mtimeMs / 1000)
  const etag = `"${rep.etagPrefix}${rep.size}-${mtimeSec}"`
  const lastModified = new Date(mtimeSec * 1000).toUTCString()

  const ifNoneMatch = req.headers.get('if-none-match')
  const ifModifiedSince = req.headers.get('if-modified-since')
  const etagMatches =
    ifNoneMatch !== null &&
    ifNoneMatch.split(',').some((candidate) => candidate.trim() === etag)
  // Per RFC 7232, If-None-Match takes precedence; only fall back to the date.
  const dateNotModified =
    ifNoneMatch === null &&
    ifModifiedSince !== null &&
    !Number.isNaN(Date.parse(ifModifiedSince)) &&
    Date.parse(ifModifiedSince) >= mtimeSec * 1000

  if (etagMatches || dateNotModified) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': CACHE_CONTROL },
    })
  }

  const data = readFileSync(rep.path)
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': rep.contentType,
      'Cache-Control': CACHE_CONTROL,
      'Last-Modified': lastModified,
      ETag: etag,
    },
  })
}

/**
 * Build the HTTP response for an agent avatar: resolves the file, serves a
 * cached display-size WebP for large sources (the original otherwise, or
 * whenever the variant cannot be made), and emits cache validators (weak-style
 * `ETag` of size+mtime, distinct per representation, plus `Last-Modified`).
 * Honors conditional requests — a matching `If-None-Match` or satisfying
 * `If-Modified-Since` returns `304` without reading the file. Returns a
 * `404` when no avatar exists.
 */
export async function serveAvatar(req: Request, agentId: string): Promise<Response> {
  // Malformed (traversal-shaped) ids are a client error — reject before any
  // filesystem touch — distinct from a valid id that simply has no avatar.
  if (!isValidAgentId(agentId)) return Response.json({ error: 'Invalid agent id' }, { status: 400 })

  const resolved = resolveAgentAvatar(agentId)
  if (!resolved) return Response.json({ error: 'Avatar not found' }, { status: 404 })

  const variant = await displayVariant(agentId, resolved)
  return respondWithRepresentation(req, variant
    ? { ...variant, contentType: 'image/webp', etagPrefix: `display-v${DISPLAY_TRANSFORM_VERSION}-` }
    : { ...resolved, etagPrefix: '' })
}
