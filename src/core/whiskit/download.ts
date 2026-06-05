/**
 * HTTP(S) download helpers for the consumer install path.
 *
 * Uses node:http/https directly (not the global fetch). In production this runs
 * server-side where Bun's fetch would work too; but it also has to run under the
 * test harness, whose global happy-dom fetch refuses loopback requests
 * (Same-Origin Policy + a stricter parser). node:http(s) talks to both a local
 * fixture host and GitHub's release-asset redirects.
 *
 * Part of the Whiskit consumer install path (Phase 6).
 */
import { createWriteStream } from 'fs'
import { get as httpGet, type IncomingMessage } from 'http'
import { get as httpsGet } from 'https'

const MAX_REDIRECTS = 5
/** Per-request inactivity timeout — a slow/unreachable host must not hang an install. */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Issue a GET and follow redirects (301/302/303/307/308) up to MAX_REDIRECTS,
 * resolving with the final 200 response stream. Rejects on non-2xx or redirect
 * loops. GitHub `releases/.../download/<asset>` 302-redirects to a CDN, so
 * following redirects is required.
 */
function fetchFinal(url: string, redirectsLeft = MAX_REDIRECTS): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let getter: typeof httpGet
    try {
      getter = new URL(url).protocol === 'https:' ? httpsGet : httpGet
    } catch (err) {
      reject(err)
      return
    }
    const req = getter(url, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume() // drain so the socket frees
        if (redirectsLeft <= 0) {
          reject(new Error(`too many redirects fetching ${url}`))
          return
        }
        const next = new URL(res.headers.location, url).toString()
        resolve(fetchFinal(next, redirectsLeft - 1))
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`HTTP ${status} fetching ${url}`))
        return
      }
      resolve(res)
    })
    req.on('error', reject)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms fetching ${url}`))
    })
  })
}

/** Download `url` to `dest`, following redirects. */
export async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetchFinal(url)
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(dest)
    res.on('error', reject)
    out.on('error', reject)
    out.on('finish', () => resolve())
    res.pipe(out)
  })
}

/** Download `url` and return the body as a UTF-8 string, following redirects. */
export async function downloadText(url: string): Promise<string> {
  const res = await fetchFinal(url)
  const chunks: Buffer[] = []
  return await new Promise<string>((resolve, reject) => {
    res.on('data', (chunk: Buffer) => chunks.push(chunk))
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    res.on('error', reject)
  })
}
