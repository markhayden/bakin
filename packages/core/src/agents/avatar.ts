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
import { IMAGE_EXTENSION_TO_MIME } from '../media/image-format'

/** Avatar formats in priority order — first existing file wins on read. */
const AVATAR_EXT_PRIORITY = ['webp', 'png', 'jpg'] as const
type AvatarExt = (typeof AVATAR_EXT_PRIORITY)[number]

/**
 * Agent ids are safe slugs — no separators means the join below can never
 * escape the agents root, and a leading alphanumeric rejects `.`/`..`.
 * Centralized here so every avatar entry point shares one guard.
 */
const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

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
  if (!AGENT_ID_RE.test(agentId)) return null
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

/**
 * Build the HTTP response for an agent avatar: resolves the file, sets the
 * matching Content-Type, and emits cache validators (weak `ETag` of
 * size+mtime, plus `Last-Modified`). Honors conditional requests — a matching
 * `If-None-Match` or satisfying `If-Modified-Since` returns `304` without
 * reading the file. Returns a bodyless `404` when no avatar exists.
 */
export function serveAvatar(req: Request, agentId: string): Response {
  const resolved = resolveAgentAvatar(agentId)
  if (!resolved) return new Response(null, { status: 404 })

  // Truncate mtime to whole seconds so it agrees with the second-precision
  // Last-Modified header during If-Modified-Since comparisons.
  const mtimeSec = Math.floor(resolved.mtimeMs / 1000)
  const etag = `"${resolved.size}-${mtimeSec}"`
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

  const data = readFileSync(resolved.path)
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': resolved.contentType,
      'Cache-Control': CACHE_CONTROL,
      'Last-Modified': lastModified,
      ETag: etag,
    },
  })
}
