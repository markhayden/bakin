/**
 * Whiskin artifact assembly + verification.
 *
 * A published artifact is a tarball of a plugin's built output:
 *   bakin-plugin.json, dist/, optional node_modules/, .whiskin/build.json
 * plus a sibling SHA256. Producers assemble + checksum it (Phase 4); consumers
 * download, verify the checksum, and SAFELY extract it (Phase 6). This module
 * owns assembly, checksum, and the guarded extractor.
 *
 * Tar mechanism mirrors the codebase's existing archive code
 * (uninstall-snapshot.ts): `Bun.spawn(['tar', ...])` — both macOS and Linux
 * ship `tar`, and it is present even on a non-developer consumer (unlike bun or
 * git). Format is `.tar.gz`; the spec aspired to `.tar.zst` but gzip is what
 * `tar -z` gives portably with no new dependency.
 *
 * Security: artifacts are untrusted input. Extraction validates every entry's
 * path (no absolute / no `..` / no backslash / allowed top-level only) BEFORE
 * extracting, caps the compressed size + entry count, and rejects ANY symlink
 * after extraction into an isolated staging dir. v1 plugins are pure-JS (no
 * node_modules), so reject-all-symlinks is correct; native-plugin support
 * (deferred Phase 7) will need the escaping-symlink-only refinement.
 *
 * Part of the Whiskin artifact format (Phase 3).
 */
import { createHash } from 'crypto'
import { createReadStream, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export type ArtifactErrorCode =
  | 'CHECKSUM_MISMATCH'
  | 'UNSAFE_ARTIFACT'
  | 'ARTIFACT_TOO_LARGE'
  | 'TAR_FAILED'

export class ArtifactError extends Error {
  readonly code: ArtifactErrorCode
  constructor(code: ArtifactErrorCode, message: string) {
    super(message)
    this.name = 'ArtifactError'
    this.code = code
  }
}

/** Top-level entries permitted inside a Whiskin plugin artifact. */
const ALLOWED_TOP_LEVEL = new Set(['bakin-plugin.json', 'dist', 'node_modules', '.whiskin'])
/** Hard cap on the compressed artifact size (bounds fetch + most abuse). */
const MAX_COMPRESSED_BYTES = 128 * 1024 * 1024
/** Hard cap on entry count (bounds pathological archives). */
const MAX_ENTRIES = 50_000

async function spawnTar(args: string[]): Promise<void> {
  const proc = Bun.spawn(['tar', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new ArtifactError('TAR_FAILED', `tar exited with code ${code}: ${stderr.trim() || '(no stderr)'}`)
  }
}

async function spawnTarText(args: string[]): Promise<string> {
  const proc = Bun.spawn(['tar', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) {
    throw new ArtifactError('TAR_FAILED', `tar exited with code ${code}: ${stderr.trim() || '(no stderr)'}`)
  }
  return stdout
}

/**
 * Assemble `stagingDir`'s contents into a `.tar.gz` at `outPath`. The staging
 * dir must already be laid out as the artifact (bakin-plugin.json, dist/, …);
 * `-C stagingDir .` archives its contents at clean relative paths.
 */
export async function assembleArtifact(stagingDir: string, outPath: string): Promise<void> {
  await spawnTar(['-czf', outPath, '-C', stagingDir, '.'])
}

/** Streaming SHA256 of a file. */
export async function computeSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject)
  })
  return hash.digest('hex')
}

/** Throw CHECKSUM_MISMATCH unless the file's SHA256 equals `expectedSha256`. */
export async function verifyChecksum(path: string, expectedSha256: string): Promise<void> {
  const actual = await computeSha256(path)
  if (actual !== expectedSha256) {
    throw new ArtifactError(
      'CHECKSUM_MISMATCH',
      `artifact checksum mismatch: expected ${expectedSha256}, got ${actual}`,
    )
  }
}

function normalizeTarEntry(entry: string): string | null {
  const trimmed = entry.trim()
  if (!trimmed || trimmed === '.' || trimmed === './') return null
  return trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
}

/**
 * Validate a `tar -tzf` listing: reject absolute/Windows paths, `..`/`.`
 * segments, unexpected top-level entries, and over-large entry counts.
 * Exported for unit testing.
 */
export function validateArtifactListing(listing: string): void {
  let count = 0
  for (const raw of listing.split('\n')) {
    const entry = normalizeTarEntry(raw)
    if (!entry) continue
    count++
    if (count > MAX_ENTRIES) {
      throw new ArtifactError('UNSAFE_ARTIFACT', `artifact has more than ${MAX_ENTRIES} entries`)
    }
    if (entry.startsWith('/') || entry.includes('\\')) {
      throw new ArtifactError('UNSAFE_ARTIFACT', `artifact contains an unsafe absolute or Windows path: ${raw}`)
    }
    const parts = entry.split('/').filter(Boolean)
    if (parts.some((part) => part === '..' || part === '.')) {
      throw new ArtifactError('UNSAFE_ARTIFACT', `artifact contains an unsafe relative path: ${raw}`)
    }
    if (!ALLOWED_TOP_LEVEL.has(parts[0]!)) {
      throw new ArtifactError('UNSAFE_ARTIFACT', `artifact contains an unexpected top-level entry: ${raw}`)
    }
  }
}

function assertNoSymlinks(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      throw new ArtifactError('UNSAFE_ARTIFACT', `artifact contains a symlink: ${full}`)
    }
    if (entry.isDirectory()) assertNoSymlinks(full)
  }
}

/**
 * Safely extract a verified artifact into `destDir` (which should be an
 * isolated staging dir, not a live install location). Caps compressed size,
 * validates the entry listing, extracts, then rejects any symlink.
 */
export async function safeExtractArtifact(tarballPath: string, destDir: string): Promise<void> {
  const size = statSync(tarballPath).size
  if (size > MAX_COMPRESSED_BYTES) {
    throw new ArtifactError(
      'ARTIFACT_TOO_LARGE',
      `artifact is ${size} bytes, over the ${MAX_COMPRESSED_BYTES}-byte cap`,
    )
  }
  validateArtifactListing(await spawnTarText(['-tzf', tarballPath]))
  mkdirSync(destDir, { recursive: true })
  await spawnTar(['-xzf', tarballPath, '-C', destDir])
  // Belt-and-suspenders: a symlink whose NAME passed validation still gets
  // rejected here, before the staging dir is ever committed to a live location.
  assertNoSymlinks(destDir)
}
