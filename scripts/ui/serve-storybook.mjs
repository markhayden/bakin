#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const STATIC_ROOT = join(REPO_ROOT, 'storybook-static-public')
const PORT = Number(process.env.BAKIN_UI_STORYBOOK_PORT ?? '6107')

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function safeStaticPath(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0])
  const requested = decoded === '/' ? '/index.html' : decoded
  const path = resolve(root, `.${requested}`)
  const child = relative(root, path)
  if (child.startsWith(`..${sep}`) || child === '..') return null
  return path
}

if (!existsSync(join(STATIC_ROOT, 'index.html'))) {
  throw new Error(`Missing ${join(STATIC_ROOT, 'index.html')}; build the public Storybook first`)
}

const server = createServer((request, response) => {
  const path = safeStaticPath(STATIC_ROOT, request.url ?? '/')
  if (!path || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(path).pipe(response)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Public Storybook fixture server listening on http://127.0.0.1:${PORT}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
