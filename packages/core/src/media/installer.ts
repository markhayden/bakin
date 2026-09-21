/**
 * Media store installer (#889): gives compiled-binary installs working
 * sharp with zero manual steps.
 *
 * Compiled bun binaries can import plain JS and dlopen a `.node` from disk
 * by PATH, but cannot resolve bare specifiers against a disk node_modules —
 * so the install bundles sharp's JS into ONE self-contained file (in-binary
 * `Bun.build`, the buildUserPlugin precedent) and places the natives where
 * sharp's own relative-path candidate (`../src/build/Release/…`) and the
 * `.node`'s rpath/RUNPATH expect them:
 *
 *   ~/.bakin/media/sharp/<version>/
 *     receipt.json                          — install receipt; the loader's trigger
 *     dist/index.js                         — bundled sharp (all JS deps inlined)
 *     src/build/Release/sharp-<plat>.node   — native, found via sharp's relative candidate
 *     src/sharp-libvips-<plat>/lib/…        — libvips, found via the native's rpath
 *
 * Everything is staged and PROBE-VERIFIED (a real resize) before an atomic
 * rename — a broken download or a future sharp layout change can never
 * shadow a working store. Install-time only: request paths never download.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getBakinPaths } from '../content-dir'
import { createLogger } from '../logger'
import { downloadToFile, extractTarball } from '../net/download'
import { SHARP_PIN, mediaPlatformKey, pinnedTarballsFor, type MediaPlatformKey } from './pin'
import { resetSharpModuleCache } from './sharp-loader'
import { MEDIA_RECEIPT_SCHEMA, mediaStoreDir, readMediaReceipt, mediaStoreEntry, type MediaReceipt } from './store'

// Store locations + receipt live in ./store (shared with the loader);
// re-exported here so install surfaces keep ONE import.
export { MEDIA_RECEIPT_SCHEMA, mediaReceiptPath, mediaStoreDir, mediaStoreEntry, readMediaReceipt, type MediaReceipt } from './store'

const log = createLogger('media-installer')

const DOWNLOAD_TIMEOUT_MS = 120_000

export type MediaStoreStatus =
  | { status: 'ok'; receipt: MediaReceipt }
  | { status: 'missing' }
  | { status: 'unsupported'; platform: string }

export function checkMediaStore(): MediaStoreStatus {
  const platform = mediaPlatformKey()
  if (!platform) return { status: 'unsupported', platform: `${process.platform}-${process.arch}` }
  const receipt = readMediaReceipt()
  if (receipt && receipt.platform === platform && mediaStoreEntry()) return { status: 'ok', receipt }
  return { status: 'missing' }
}

export interface MediaInstallOptions {
  /** Tests pass Bun.fetch — happy-dom's global fetch can't drive real sockets. */
  fetchImpl?: typeof fetch
  /** Re-install even when the receipt already matches the pin. */
  force?: boolean
  /**
   * Seam for unit tests and the compile-and-run fixture: pre-populates the
   * staging node_modules instead of downloading pinned tarballs.
   */
  stage?: (nodeModulesDir: string) => Promise<void>
  /** Bundle seam — default is the real in-binary Bun.build. */
  bundle?: (entrypoint: string, outDir: string) => Promise<void>
  /** Probe seam — default imports the staged bundle and runs a real resize. */
  probe?: (bundlePath: string) => Promise<void>
}

export interface MediaInstallResult {
  storeDir: string
  skipped: boolean
}

/**
 * Download → stage → bundle → place → probe-verify → atomic commit.
 * Idempotent: a receipt already at the pin (for this platform) skips all work.
 */
export async function installMediaStore(options: MediaInstallOptions = {}): Promise<MediaInstallResult> {
  const platform = mediaPlatformKey()
  if (!platform) {
    throw new Error(
      `media store is not available on this platform (${process.platform}-${process.arch}) — `
      + `supported: darwin-arm64, linux-x64, linux-arm64 (glibc)`,
    )
  }

  const storeDir = mediaStoreDir()
  if (!options.force) {
    const existing = checkMediaStore()
    if (existing.status === 'ok') {
      log.info(`media store already at sharp ${SHARP_PIN.version} — skipping install`)
      return { storeDir, skipped: true }
    }
  }

  const sharpRoot = join(getBakinPaths().media, 'sharp')
  const staging = join(sharpRoot, `.staging-${SHARP_PIN.version}-${process.pid}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  try {
    // 1. Stage a standard node_modules layout from the pinned tarballs.
    const nodeModules = join(staging, 'node_modules')
    if (options.stage) {
      await options.stage(nodeModules)
    } else {
      const tarballDir = join(staging, '.tarballs')
      for (const tarball of pinnedTarballsFor(platform)) {
        const tarPath = join(tarballDir, `${tarball.name.replace('/', '+')}.tgz`)
        await downloadToFile(tarball.url, tarPath, {
          sha256: tarball.sha256,
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          fetchImpl: options.fetchImpl,
          label: `Media tarball "${tarball.name}"`,
        })
        await extractTarball(tarPath, join(nodeModules, tarball.name), {
          stripComponents: 1,
          label: `Media tarball "${tarball.name}"`,
        })
      }
    }

    // 2. Bundle sharp's JS into one self-contained file — compiled binaries
    //    cannot walk a disk node_modules for bare specifiers.
    const bundle = options.bundle ?? bundleSharp
    await bundle(join(nodeModules, 'sharp', 'lib', 'index.js'), join(staging, 'dist'))

    // 3. Place natives for sharp's relative candidate + the rpath/RUNPATH.
    placeNatives(staging, nodeModules, platform)

    // 4. Probe-verify: a REAL resize against the staged bundle. This is the
    //    tripwire for sharp changing its candidate paths on a future bump.
    const probe = options.probe ?? probeSharpBundle
    await probe(join(staging, 'dist', 'index.js'))

    // 5. Prune build inputs; commit atomically; sweep older versions.
    rmSync(nodeModules, { recursive: true, force: true })
    rmSync(join(staging, '.tarballs'), { recursive: true, force: true })
    const receipt: MediaReceipt = {
      schema: MEDIA_RECEIPT_SCHEMA,
      sharpVersion: SHARP_PIN.version,
      platform,
      entry: join('dist', 'index.js'),
      installedAt: new Date().toISOString(),
      tarballs: pinnedTarballsFor(platform).map(({ name, version, sha256 }) => ({ name, version, sha256 })),
    }
    writeFileSync(join(staging, 'receipt.json'), JSON.stringify(receipt, null, 2), 'utf-8')
    rmSync(storeDir, { recursive: true, force: true })
    renameSync(staging, storeDir)
    sweepOldStores(sharpRoot)
    // An in-process loader that already cached "sharp unavailable" must see
    // the fresh store without a restart (doctor repair path).
    resetSharpModuleCache()
    log.info(`media store installed: sharp ${SHARP_PIN.version} (${platform}) → ${storeDir}`)
    return { storeDir, skipped: false }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    throw err
  }
}

/** In-binary Bun.build of sharp's entry — all JS deps inlined, natives dynamic. */
async function bundleSharp(entrypoint: string, outDir: string): Promise<void> {
  let result: Bun.BuildResult
  try {
    result = await Bun.build({
      entrypoints: [entrypoint],
      outdir: outDir,
      target: 'bun',
      format: 'cjs',
      // Never-installed optional ids sharp requires inside try/catch; the
      // real natives load through sharp's DYNAMIC candidate loop at runtime.
      external: ['@img/sharp-libvips-dev', '@img/sharp-libvips-dev/*', '@img/sharp-wasm32', '@img/sharp-wasm32/*'],
    })
  } catch (err) {
    const logs = (err as { logs?: unknown[] }).logs ?? []
    throw new Error(
      `sharp bundle failed: ${err instanceof Error ? err.message : String(err)}`
      + (logs.length ? ` — ${logs.map((l) => (l as { message?: string }).message ?? String(l)).join(' | ').slice(0, 600)}` : ''),
    )
  }
  if (!result.success) {
    throw new Error(`sharp bundle failed: ${result.logs.map((l) => String(l)).join(' | ').slice(0, 600)}`)
  }
}

/**
 * Copy the native `.node` to sharp's first require candidate
 * (`../src/build/Release/sharp-<plat>.node`, relative to dist/) and the
 * libvips lib dir to the rpath target (`@loader_path/../../sharp-libvips-…/lib`
 * on darwin, `$ORIGIN`-symmetric on linux — the linux leg is pinned by the
 * compile-and-run test on CI).
 */
function placeNatives(staging: string, nodeModules: string, platform: MediaPlatformKey): void {
  const nativeSource = join(nodeModules, `@img/sharp-${platform}`, 'lib', `sharp-${platform}.node`)
  if (!existsSync(nativeSource)) {
    throw new Error(`media store: native module missing from tarball layout (${nativeSource})`)
  }
  const release = join(staging, 'src', 'build', 'Release')
  mkdirSync(release, { recursive: true })
  cpSync(nativeSource, join(release, `sharp-${platform}.node`))

  const libvipsSource = join(nodeModules, `@img/sharp-libvips-${platform}`, 'lib')
  if (!existsSync(libvipsSource)) {
    throw new Error(`media store: libvips lib dir missing from tarball layout (${libvipsSource})`)
  }
  cpSync(libvipsSource, join(staging, 'src', `sharp-libvips-${platform}`, 'lib'), { recursive: true })
}

/** 1x1 red PNG — enough for a real decode→resize→encode round trip. */
const PROBE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function probeSharpBundle(bundlePath: string): Promise<void> {
  const dir = join(bundlePath, '..', '.probe')
  mkdirSync(dir, { recursive: true })
  try {
    const input = join(dir, 'probe.png')
    writeFileSync(input, Buffer.from(PROBE_PNG_BASE64, 'base64'))
    const mod = (await import(bundlePath)) as { default?: unknown }
    const sharp = (mod.default ?? mod) as (path: string) => {
      metadata(): Promise<{ width?: number }>
      resize(w: number, h: number, o: object): { jpeg(o: object): { toFile(p: string): Promise<unknown> } }
    }
    const meta = await sharp(input).metadata()
    if (meta.width !== 1) {
      throw new Error(`probe metadata returned width ${meta.width}, expected 1`)
    }
    const out = join(dir, 'probe.jpg')
    await sharp(input).resize(64, 64, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(out)
    if (statSync(out).size === 0) throw new Error('probe resize produced an empty file')
  } catch (err) {
    throw new Error(`media store probe failed — refusing to commit: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Remove version dirs other than the pinned one (post-commit hygiene). */
function sweepOldStores(sharpRoot: string): void {
  let entries: string[]
  try {
    entries = readdirSync(sharpRoot)
  } catch {
    return // nothing to sweep
  }
  for (const entry of entries) {
    if (entry === SHARP_PIN.version || entry.startsWith('.staging-')) continue
    try {
      rmSync(join(sharpRoot, entry), { recursive: true, force: true })
      log.info(`media store: swept old version dir ${entry}`)
    } catch (err) {
      log.warn(`media store: failed to sweep ${entry}`, { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
