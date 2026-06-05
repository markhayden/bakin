/**
 * Hermetic artifact host for Whiskin consumer-path tests.
 *
 * The consumer install path (Phase 6) downloads a published artifact + its
 * `.sha256` + `whiskin-artifacts.json` over HTTPS. Tests must never hit the
 * real network or GitHub. This helper serves a local directory over
 * `http://127.0.0.1:<ephemeral-port>/` so a test can point a resolver at a
 * fixture release and exercise download/verify/extract end-to-end offline.
 *
 * It is intentionally format-agnostic: it serves whatever bytes you place in
 * the root dir (tarball, checksum file, index JSON). The artifact tarball
 * format itself is defined in Phase 3; this host does not assume it.
 *
 * Implementation note: uses `node:http` (not `Bun.serve`) on purpose. The test
 * runner registers happy-dom globally, whose `fetch` drives node's HTTP client
 * — which rejects some `Bun.serve` responses with `HPE_UNEXPECTED_CONTENT_LENGTH`.
 * A `node:http` server (the same shape Bakin's real `server.ts` uses) is fully
 * compatible with that client.
 *
 * Usage:
 *
 *   const host = await startArtifactServer(fixtureDir)
 *   try {
 *     const res = await fetch(`${host.origin}/messaging-0.1.0.tar.zst`)
 *     ...
 *   } finally {
 *     await host.stop()
 *   }
 */
import { createServer, type Server } from 'http'
import { createReadStream } from 'fs'
import { readFile, stat, writeFile, mkdir } from 'fs/promises'
import { createHash } from 'crypto'
import { join, normalize, sep } from 'path'
import { once } from 'events'

export interface ArtifactServer {
  /** e.g. `http://127.0.0.1:54123` — no trailing slash. */
  origin: string
  port: number
  /** Stop the server and free the port. */
  stop: () => Promise<void>
  /** Count of requests served, for assertions ("downloaded exactly once"). */
  requestCount: () => number
}

/**
 * Serve `rootDir` over an ephemeral localhost port. Path traversal outside
 * `rootDir` is refused (403). Missing files return 404. No directory listing.
 */
export async function startArtifactServer(rootDir: string): Promise<ArtifactServer> {
  let requests = 0
  const resolvedRoot = normalize(rootDir)

  const server: Server = createServer((req, res) => {
    requests++
    void (async () => {
      try {
        const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
        const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '')
        const full = normalize(join(resolvedRoot, rel))
        if (full !== resolvedRoot && !full.startsWith(resolvedRoot + sep)) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }
        const st = await stat(full)
        if (!st.isFile()) {
          res.statusCode = 404
          res.end('not found')
          return
        }
        res.statusCode = 200
        res.setHeader('content-length', st.size)
        createReadStream(full).pipe(res)
      } catch {
        res.statusCode = 404
        res.end('not found')
      }
    })()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('artifact server failed to bind an ephemeral port')
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requestCount: () => requests,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

/**
 * Write `<name>` and its sibling `<name>.sha256` into `dir`, returning the
 * SHA256. Mirrors how `bakin plugins publish` will emit an artifact + checksum.
 * Format-agnostic: `bytes` can be any artifact payload.
 */
export async function writeArtifactWithChecksum(
  dir: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  await mkdir(dir, { recursive: true })
  const sha = createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(dir, name), bytes)
  await writeFile(join(dir, `${name}.sha256`), `${sha}  ${name}\n`, 'utf-8')
  return sha
}

// `readFile` is part of the helper's public surface for tests that want to read
// fixture bytes back without re-importing fs/promises.
export { readFile as readFixtureFile }
