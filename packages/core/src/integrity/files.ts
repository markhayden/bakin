/**
 * Streaming file integrity — the ONE "do these bytes match their pin?"
 * check for large pinned files (models). It always hashes: no size/mtime
 * cache and no marker is ever accepted as proof (#898 E). The hashing is the
 * download primitive's own (`sha256File`), so a file verified here hashes
 * exactly as it did when it was downloaded. Knows nothing about packs or
 * search engines — callers enumerate their own files.
 */
import { statSync } from 'fs'
import { sha256File } from '../net/download'

export type FileIntegrityVerdict =
  | { ok: true; sha256: string }
  | { ok: false; reason: 'missing' | 'not-a-file' | 'size-mismatch' | 'hash-mismatch' | 'unreadable'; detail: string }

/**
 * Hash `path` and compare it with `expectedSha256` (and `bytes`, when given,
 * checked first — a cheap early answer, never a substitute for the hash).
 * Never throws: an absent or unreadable file is a failed verdict.
 */
export async function verifyFileSha256(path: string, expectedSha256: string, opts: { bytes?: number } = {}): Promise<FileIntegrityVerdict> {
  let size: number
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return { ok: false, reason: 'not-a-file', detail: `${path} is not a regular file` }
    size = stat.size
  } catch {
    return { ok: false, reason: 'missing', detail: `${path} is missing` }
  }
  if (opts.bytes !== undefined && size !== opts.bytes) {
    return { ok: false, reason: 'size-mismatch', detail: `${path} is ${size} bytes, expected ${opts.bytes}` }
  }
  let actual: string
  try {
    actual = await sha256File(path)
  } catch (err) {
    return { ok: false, reason: 'unreadable', detail: `${path} could not be read: ${err instanceof Error ? err.message : String(err)}` }
  }
  return actual === expectedSha256.toLowerCase()
    ? { ok: true, sha256: actual }
    : { ok: false, reason: 'hash-mismatch', detail: `${path} sha256 ${actual} does not match the pin ${expectedSha256.toLowerCase()}` }
}
