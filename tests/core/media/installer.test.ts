/**
 * Media store installer (#889 T5).
 *
 * Unit truth: staging/layout/receipt/commit semantics with the download
 * driven through a loopback Bun.serve and the bundle/probe seams injected.
 * The REAL bundle+probe path inside a compiled binary is pinned by
 * tests/integration/media/compiled-sharp-store.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-media-installer-${Date.now()}-${Math.random().toString(16).slice(2)}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// Pin a FIXTURE tarball set: every entry resolves against the loopback
// server (URLs patched in beforeAll once the port is known). The PIN module
// itself is mocked — pin.ts captures pin-data into a const at module-eval
// time, so a pin-data mock lands too late; the pin module's exports are
// accessed lazily through live bindings and swap cleanly.
type Tarball = { name: string; version: string; url: string; sha256: string }
const pinData = {
  version: '0.0.1-fixture',
  shared: [] as Tarball[],
  platform: {
    'darwin-arm64': [] as Tarball[],
    'linux-x64': [] as Tarball[],
    'linux-arm64': [] as Tarball[],
  },
}
mock.module('../../../packages/core/src/media/pin', () => ({
  MEDIA_PLATFORM_KEYS: ['darwin-arm64', 'linux-x64', 'linux-arm64'] as const,
  SHARP_PIN: pinData,
  mediaPlatformKey: () => {
    if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64'
    if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
    if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64'
    return null
  },
  pinnedTarballsFor: (key: keyof typeof pinData.platform) => [...pinData.shared, ...pinData.platform[key]],
}))

// The no-restart guarantee: the installer must reset the loader cache after
// a successful commit (doctor-repair path). Spied here; behavior of the
// reset itself is covered in sharp-loader.test.ts.
let loaderResets = 0
mock.module('../../../packages/core/src/media/sharp-loader', () => ({
  resetSharpModuleCache: () => { loaderResets += 1 },
}))

import { checkMediaStore, installMediaStore, mediaStoreDir, mediaStoreEntry, readMediaReceipt } from '../../../packages/core/src/media/installer'
import { mediaPlatformKey } from '../../../packages/core/src/media/pin'

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
const bunServe = (Bun as unknown as {
  serve: (opts: { port: number; fetch: (req: Request) => Response }) => { port: number; stop: (force?: boolean) => void }
}).serve

const platform = mediaPlatformKey()
if (!platform) throw new Error('unsupported test platform')

let server: { port: number; stop: (force?: boolean) => void }
const fixtures: Record<string, Buffer> = {}

/** Build an npm-shaped tarball (package/ root) holding the given files. */
function makeTarball(tag: string, files: Record<string, string | Buffer>): Buffer {
  const src = join(testDir, `tar-fixture-${tag}`, 'package')
  for (const [rel, contents] of Object.entries(files)) {
    mkdirSync(join(src, rel, '..'), { recursive: true })
    writeFileSync(join(src, rel), contents)
  }
  const tarPath = join(testDir, `tar-fixture-${tag}.tgz`)
  execSync(`tar -czf ${JSON.stringify(tarPath)} -C ${JSON.stringify(join(src, '..'))} package`)
  return readFileSync(tarPath)
}

beforeAll(() => {
  server = bunServe({
    port: 0,
    fetch(req: Request) {
      const path = new URL(req.url).pathname
      if (fixtures[path]) return new NativeResponse(new Uint8Array(fixtures[path]!))
      return new NativeResponse('nope', { status: 404 })
    },
  })
  mkdirSync(testDir, { recursive: true })

  const sharpTar = makeTarball('sharp', { 'lib/index.js': 'module.exports = () => {}\n' })
  const nativeTar = makeTarball('native', { [`lib/sharp-${platform}.node`]: Buffer.from('fake-native') })
  const libvipsTar = makeTarball('libvips', { 'lib/libvips-fixture.dylib': Buffer.from('fake-libvips') })
  fixtures['/sharp.tgz'] = sharpTar
  fixtures['/native.tgz'] = nativeTar
  fixtures['/libvips.tgz'] = libvipsTar

  const url = (p: string) => `http://127.0.0.1:${server.port}${p}`
  pinData.shared = [{ name: 'sharp', version: '0.0.1-fixture', url: url('/sharp.tgz'), sha256: sha256(sharpTar) }]
  pinData.platform[platform] = [
    { name: `@img/sharp-${platform}`, version: '0.0.1', url: url('/native.tgz'), sha256: sha256(nativeTar) },
    { name: `@img/sharp-libvips-${platform}`, version: '1.0.0', url: url('/libvips.tgz'), sha256: sha256(libvipsTar) },
  ]
})

afterAll(() => {
  server.stop(true)
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(testDir, 'media'), { recursive: true, force: true })
  loaderResets = 0
})

const fakeBundle = async (_entry: string, outDir: string): Promise<void> => {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.js'), '// bundled fixture\n')
}
const okProbe = async (): Promise<void> => {}

describe('installMediaStore', () => {
  it('downloads, stages, places natives, and commits with a receipt', async () => {
    const result = await installMediaStore({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    expect(result.skipped).toBe(false)
    expect(result.storeDir).toBe(mediaStoreDir())

    // Committed layout: bundle + natives at sharp's candidate paths; build
    // inputs pruned.
    expect(readFileSync(join(result.storeDir, 'dist', 'index.js'), 'utf-8')).toContain('bundled fixture')
    expect(existsSync(join(result.storeDir, 'src', 'build', 'Release', `sharp-${platform}.node`))).toBe(true)
    expect(existsSync(join(result.storeDir, 'src', `sharp-libvips-${platform}`, 'lib', 'libvips-fixture.dylib'))).toBe(true)
    expect(existsSync(join(result.storeDir, 'node_modules'))).toBe(false)
    expect(existsSync(join(result.storeDir, '.tarballs'))).toBe(false)

    const receipt = readMediaReceipt()
    expect(receipt?.sharpVersion).toBe('0.0.1-fixture')
    expect(receipt?.platform).toBe(platform)
    expect(mediaStoreEntry()).toBe(join(result.storeDir, 'dist', 'index.js'))
    expect(checkMediaStore().status).toBe('ok')
    // No-restart guarantee: a cached loader failure must be reset post-commit.
    expect(loaderResets).toBe(1)
  })

  it('is idempotent: a receipt at the pin skips all work', async () => {
    await installMediaStore({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    let bundled = 0
    const again = await installMediaStore({
      fetchImpl: nativeFetch,
      bundle: async (e, o) => { bundled += 1; await fakeBundle(e, o) },
      probe: okProbe,
    })
    expect(again.skipped).toBe(true)
    expect(bundled).toBe(0)
    expect(loaderResets).toBe(1) // only the initial install reset the loader
  })

  it('force re-installs over a matching receipt', async () => {
    await installMediaStore({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    const again = await installMediaStore({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe, force: true })
    expect(again.skipped).toBe(false)
  })

  it('a failed probe leaves NO store dir and surfaces the sharp error', async () => {
    await expect(installMediaStore({
      fetchImpl: nativeFetch,
      bundle: fakeBundle,
      probe: async () => { throw new Error('media store probe failed — refusing to commit: fixture') },
    })).rejects.toThrow(/probe failed/)
    expect(existsSync(mediaStoreDir())).toBe(false)
    expect(checkMediaStore().status).toBe('missing')
    // No staging leftovers either.
    expect(existsSync(join(testDir, 'media', 'sharp'))
      ? (await import('fs')).readdirSync(join(testDir, 'media', 'sharp')).filter((e) => e.startsWith('.staging-'))
      : []).toEqual([])
  })

  it('a checksum mismatch refuses the install', async () => {
    const good = pinData.shared[0]!
    pinData.shared = [{ ...good, sha256: sha256('tampered') }]
    try {
      await expect(installMediaStore({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe }))
        .rejects.toThrow(/checksum/i)
      expect(existsSync(mediaStoreDir())).toBe(false)
    } finally {
      pinData.shared = [good]
    }
  })

  it('sweeps DEAD staging dirs (killed installers) before staging anew', async () => {
    // margo 2026-09-21: three orphaned .staging-* dirs from killed installs.
    const deadStaging = join(testDir, 'media', 'sharp', '.staging-0.0.1-fixture-999999')
    mkdirSync(deadStaging, { recursive: true })
    writeFileSync(join(deadStaging, 'partial.tgz'), 'x')
    // pid 1 is always alive (launchd/init) — a LIVE installer's staging survives.
    const liveStaging = join(testDir, 'media', 'sharp', '.staging-0.0.1-fixture-1')
    mkdirSync(liveStaging, { recursive: true })

    await installMediaStore({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })

    expect(existsSync(deadStaging)).toBe(false)
    expect(existsSync(liveStaging)).toBe(true)
    rmSync(liveStaging, { recursive: true, force: true })
  })

  it('sweeps older version dirs after a successful commit', async () => {
    const oldDir = join(testDir, 'media', 'sharp', '0.0.0-old')
    mkdirSync(oldDir, { recursive: true })
    writeFileSync(join(oldDir, 'receipt.json'), '{}')
    await installMediaStore({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    expect(existsSync(oldDir)).toBe(false)
    expect(existsSync(mediaStoreDir())).toBe(true)
  })
})

describe('checkMediaStore', () => {
  it('reports missing when nothing is installed', () => {
    expect(checkMediaStore().status).toBe('missing')
  })

  it('reports missing when the receipt is for another sharp version', async () => {
    await installMediaStore({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    const receiptPath = join(mediaStoreDir(), 'receipt.json')
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8')) as { sharpVersion: string }
    receipt.sharpVersion = '0.0.0-other'
    writeFileSync(receiptPath, JSON.stringify(receipt))
    expect(checkMediaStore().status).toBe('missing')
  })
})
