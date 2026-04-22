/**
 * Static asset + SPA fallback server for the Bakin host bundle.
 *
 * Serves:
 *   /assets/<name>    → packages/host/dist/<name>  (main.js, main.css, *.map)
 *   /globals.css      → packages/host/public/globals.css
 *   /favicon.ico      → packages/host/public/favicon.ico (404 ok if absent)
 *   anything else     → packages/host/public/index.html  (SPA fallback;
 *                        TanStack Router handles client-side routing)
 *
 * API paths (`/api/*`) and MCP (`/mcp/*`) are matched earlier in server.ts
 * and never reach this handler.
 *
 * Phase G wraps this up in the compiled binary via `Bun.embeddedFiles`.
 * Until then we read directly from disk.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { join, extname, resolve } from 'path'

// Repo-root-relative. server.ts is always invoked from the repo root so
// process.cwd() is stable. Phase G replaces this with `Bun.embeddedFiles`
// lookup inside the compiled binary.
const DIST_DIR = resolve(process.cwd(), 'packages/host/dist')
const PUBLIC_DIR = resolve(process.cwd(), 'packages/host/public')

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
}

function sendFile(res: ServerResponse, path: string, status = 200): boolean {
  if (!existsSync(path)) return false
  const stat = statSync(path)
  if (!stat.isFile()) return false
  const mime = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(status, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': status === 200 && path.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
  })
  createReadStream(path).pipe(res)
  return true
}

/**
 * Try to serve a static asset or fall back to index.html. Returns true if
 * the request was handled (response started); false otherwise.
 */
export function serveHostClient(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  // Only GET/HEAD make sense for static serving.
  if (req.method !== 'GET' && req.method !== 'HEAD') return false

  const pathname = url.pathname

  // /assets/* → dist/
  if (pathname.startsWith('/assets/')) {
    const rel = pathname.slice('/assets/'.length)
    if (rel.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Bad request')
      return true
    }
    if (sendFile(res, join(DIST_DIR, rel))) return true
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return true
  }

  // /globals.css, /favicon.ico → public/ (exact match only to avoid surprises)
  if (pathname === '/globals.css' || pathname === '/favicon.ico') {
    if (sendFile(res, join(PUBLIC_DIR, pathname.slice(1)))) return true
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return true
  }

  // SPA fallback — every other GET returns index.html so TanStack Router
  // handles the route client-side.
  if (sendFile(res, join(PUBLIC_DIR, 'index.html'))) return true

  res.writeHead(500, { 'Content-Type': 'text/plain' })
  res.end('Host bundle not built — run `bun run build:host`')
  return true
}
