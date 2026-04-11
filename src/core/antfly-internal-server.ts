/**
 * Loopback-only HTTP server that lets Antfly fetch asset files during
 * multimodal indexing. Bound to 127.0.0.1 only — never reachable via
 * Tailscale or any other interface.
 *
 * Route: GET /api/internal/assets/raw/{path}?t={token}
 *
 * Security layers (defense in depth):
 *   1. Bind explicitly to 127.0.0.1 — network layer
 *   2. Shared token in query param — auth layer
 *   3. Path confinement under getBakinPaths().assets via path.resolve
 *      and fs.realpathSync — prevents traversal and symlink escapes
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { existsSync, createReadStream, realpathSync, statSync } from 'fs'
import { resolve, sep, extname, normalize } from 'path'
import { URL } from 'url'
import { getSettings } from './settings'
import { getBakinPaths } from './content-dir'
import { getOrCreateToken, verifyToken } from './antfly-internal-token'
import { createLogger } from './logger'

const log = createLogger('antfly-internal-server')

const ROUTE_PREFIX = '/api/internal/assets/raw/'

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
}

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Resolve a request path to an absolute file under the assets root, or null
 * if the path escapes the root, contains traversal segments, or does not
 * point at a real file.
 */
export function resolveAssetPath(rawPath: string): string | null {
  const assetsRoot = getBakinPaths().assets

  // Decode percent-encoding and drop any query/fragment (defensive — the
  // caller strips these, but we re-check).
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }

  if (decoded.includes('\0')) return null
  // Normalize and reject any '..' segment explicitly before path.resolve
  // would quietly absorb them.
  const normalized = normalize(decoded)
  if (normalized.split(/[\\/]/).includes('..')) return null

  const resolved = resolve(assetsRoot, normalized.replace(/^[\\/]+/, ''))
  if (resolved !== assetsRoot && !resolved.startsWith(assetsRoot + sep)) return null

  try {
    if (!existsSync(resolved)) return null
    const real = realpathSync(resolved)
    if (real !== assetsRoot && !real.startsWith(assetsRoot + sep)) return null
    const stat = statSync(real)
    if (!stat.isFile()) return null
    return real
  } catch {
    return null
  }
}

/**
 * Build an Antfly-consumable URL for an asset at a path relative to the
 * assets root (e.g. 'images/test/foo.png'). Pure function — caller passes
 * the current port and token, making this easy to test without settings.
 */
export function buildAssetUrl(relPath: string, port: number, token: string): string {
  const clean = relPath.replace(/^[\\/]+/, '')
  const encoded = clean.split('/').map(encodeURIComponent).join('/')
  return `http://127.0.0.1:${port}/api/internal/assets/raw/${encoded}?t=${token}`
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedToken: string,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' })
    res.end('Method Not Allowed')
    return
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (!url.pathname.startsWith(ROUTE_PREFIX)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
    return
  }

  const providedToken = url.searchParams.get('t')
  if (!verifyToken(providedToken, expectedToken)) {
    res.writeHead(401, { 'Content-Type': 'text/plain' })
    res.end('Unauthorized')
    return
  }

  const rawPath = url.pathname.slice(ROUTE_PREFIX.length)
  const resolved = resolveAssetPath(rawPath)
  if (!resolved) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
    return
  }

  const stat = statSync(resolved)
  res.writeHead(200, {
    'Content-Type': contentTypeFor(resolved),
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(resolved).pipe(res)
}

// ---------------------------------------------------------------------------
// Listener lifecycle
// ---------------------------------------------------------------------------

const _g = globalThis as typeof globalThis & {
  __bakinInternalServer?: Server | null
}

export async function start(): Promise<{ port: number; token: string } | null> {
  if (_g.__bakinInternalServer) {
    const settings = getSettings()
    return { port: settings.antfly.internal.port, token: settings.antfly.internal.token }
  }

  const token = getOrCreateToken()
  const port = getSettings().antfly.internal.port

  const server = createServer((req, res) => {
    handleRequest(req, res, token).catch((err) => {
      log.error('Internal file server request failed', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      }
    })
  })

  return new Promise((resolvePromise) => {
    server.once('error', (err) => {
      log.error('Internal file server failed to bind — multimodal indexing disabled', err)
      resolvePromise(null)
    })
    server.listen(port, '127.0.0.1', () => {
      _g.__bakinInternalServer = server
      const addr = server.address()
      const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port
      log.info(`Internal file server listening on http://127.0.0.1:${actualPort} (loopback only)`)
      resolvePromise({ port: actualPort, token })
    })
  })
}

export async function stop(): Promise<void> {
  const server = _g.__bakinInternalServer
  if (!server) return
  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise())
  })
  _g.__bakinInternalServer = null
}

export function isRunning(): boolean {
  return _g.__bakinInternalServer !== null && _g.__bakinInternalServer !== undefined
}
