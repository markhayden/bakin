/**
 * Media store installer (#889 T5).
 *
 * Unit truth: staging/layout/receipt/commit semantics with the download
 * driven through a loopback Bun.serve and the bundle/probe seams injected.
 * The REAL bundle+probe path inside a compiled binary is pinned by
 * tests/integration/media/compiled-sharp-store.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
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

import { checkMediaStore, installMediaStore, MEDIA_PLAN, mediaStoreDir, mediaStoreEntry, readMediaReceipt, type MediaInstallOptions } from '../../../packages/core/src/media/installer'
import { settleOperation, withOperation, withOperationView } from '../../helpers/operation-harness'
import { createMemoryResourceAcquirer, createOperationRegistry, resourceLockPath } from '../../../packages/core/src/operations'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../../src/core/operations'
import { waitUntil } from '../../helpers/wait'

/** The installer runs inside an operation that holds media-store, as in production. */
const mediaInstall = (opts: MediaInstallOptions) =>
  withOperation({ plan: MEDIA_PLAN, resources: ['media-store'] }, (op) => installMediaStore(op, opts))
import { mediaPlatformKey } from '../../../packages/core/src/media/pin'

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
const bunServe = (Bun as unknown as {
  serve: (opts: { port: number; fetch: (req: Request) => Response | Promise<Response> }) => { port: number; stop: (force?: boolean) => void }
}).serve

const platform = mediaPlatformKey()
if (!platform) throw new Error('unsupported test platform')

let server: { port: number; stop: (force?: boolean) => void }
let stallsLeft = 0
/** While set, the libvips tarball answers only after it resolves (a slow download to cancel in). */
let holdLibvips: Promise<void> | null = null
const tarballRequests: string[] = []
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
    async fetch(req: Request) {
      const path = new URL(req.url).pathname
      tarballRequests.push(path)
      if (path === '/libvips.tgz' && holdLibvips) await holdLibvips
      // The margo signature: the registry answers, sends a little, then the
      // body never moves again. `stallsLeft` counts how many requests do it.
      if (path === '/libvips.tgz' && stallsLeft > 0) {
        stallsLeft -= 1
        const body = fixtures[path]!
        return new NativeResponse(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new Uint8Array(body.subarray(0, 64))) },
        }), { headers: { 'content-length': String(body.length) } })
      }
      if (fixtures[path]) return new NativeResponse(new Uint8Array(fixtures[path]!))
      return new NativeResponse('nope', { status: 404 })
    },
  })
  mkdirSync(testDir, { recursive: true })

  // sharp ≥0.35 layout: CJS entry under dist/, version-suffixed native.
  const sharpTar = makeTarball('sharp', { 'dist/index.cjs': 'module.exports = () => {}\n' })
  const nativeTar = makeTarball('native', { [`lib/sharp-${platform}-${pinData.version}.node`]: Buffer.from('fake-native') })
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
    const result = await mediaInstall({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    expect(result.skipped).toBe(false)
    expect(result.storeDir).toBe(mediaStoreDir())

    // Committed layout: bundle + natives at sharp's candidate paths; build
    // inputs pruned.
    expect(readFileSync(join(result.storeDir, 'dist', 'index.js'), 'utf-8')).toContain('bundled fixture')
    expect(existsSync(join(result.storeDir, 'src', 'build', 'Release', `sharp-${platform}-${pinData.version}.node`))).toBe(true)
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
    await mediaInstall({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    let bundled = 0
    const again = await mediaInstall({
      fetchImpl: nativeFetch,
      bundle: async (e, o) => { bundled += 1; await fakeBundle(e, o) },
      probe: okProbe,
    })
    expect(again.skipped).toBe(true)
    expect(bundled).toBe(0)
    expect(loaderResets).toBe(1) // only the initial install reset the loader
  })

  it('force re-installs over a matching receipt', async () => {
    await mediaInstall({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    const again = await mediaInstall({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe, force: true })
    expect(again.skipped).toBe(false)
  })

  it('a library-validation dlopen failure names the REAL fix (signed-binary entitlement), not npm advice', async () => {
    await expect(mediaInstall({
      fetchImpl: nativeFetch,
      bundle: fakeBundle,
      probe: async () => {
        // Real dlopen shape from margo rc.33.
        throw new Error('media store probe failed — refusing to commit: Could not load the "sharp" module using the darwin-arm64 runtime ERR_DLOPEN_FAILED: dlopen(...sharp-darwin-arm64.node, 0x0001): tried: ... (code signature in <43BC947D> ... not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs)')
      },
    })).rejects.toThrow(/blocks third-party native libraries[^]*library-validation entitlement/)
    expect(existsSync(mediaStoreDir())).toBe(false)
  })

  it('a failed probe leaves NO store dir and surfaces the sharp error', async () => {
    await expect(mediaInstall({
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
      await expect(mediaInstall({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe }))
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

    await mediaInstall({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })

    expect(existsSync(deadStaging)).toBe(false)
    expect(existsSync(liveStaging)).toBe(true)
    rmSync(liveStaging, { recursive: true, force: true })
  })

  it('sweeps older version dirs after a successful commit', async () => {
    const oldDir = join(testDir, 'media', 'sharp', '0.0.0-old')
    mkdirSync(oldDir, { recursive: true })
    writeFileSync(join(oldDir, 'receipt.json'), '{}')
    await mediaInstall({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    expect(existsSync(oldDir)).toBe(false)
    expect(existsSync(mediaStoreDir())).toBe(true)
  })
})

describe('installMediaStore as an operation (#895)', () => {
  it('refuses to run unless the caller holds media-store', async () => {
    await expect(withOperation({ plan: MEDIA_PLAN }, (op) => installMediaStore(op, { fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })))
      .rejects.toThrow('requires the media-store resource')
    expect(existsSync(mediaStoreDir())).toBe(false)
  })

  it('reports the plan: one download item per pinned tarball with bytes, then extract, bundle, verify, commit', async () => {
    const { view } = await withOperationView({ plan: MEDIA_PLAN, resources: ['media-store'] }, (op) => installMediaStore(op, { fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe }))
    expect(view.stages.map((s) => [s.id, s.status])).toEqual([
      ['prepare', 'done'], ['download', 'done'], ['extract', 'done'], ['bundle', 'done'], ['verify', 'done'], ['commit', 'done'],
    ])
    const download = view.stages.find((s) => s.id === 'download')!
    expect(download.items?.map((i) => i.status)).toEqual(['done', 'done', 'done'])
    for (const item of download.items!) expect(item.bytes?.received).toBeGreaterThan(0)
    expect(view.stages.find((s) => s.id === 'extract')!.items).toHaveLength(3)
  })

  it('margo replay: a stalled registry stream is visible, retried with a fresh request, and the install completes', async () => {
    stallsLeft = 1
    const { view } = await withOperationView({ plan: MEDIA_PLAN, resources: ['media-store'] }, (op) => installMediaStore(op, { fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe, stallTimeoutMs: 150 }))
    const download = view.stages.find((s) => s.id === 'download')!
    expect(download.attempt).toMatchObject({ n: 2, of: 2, reason: 'stalled' })
    expect(view.log.some((l) => l.level === 'warn' && /no data for/.test(l.text))).toBe(true)
    expect(download.items?.every((i) => i.status === 'done')).toBe(true)
    expect(checkMediaStore().status).toBe('ok')
  })

  it('margo replay: a stream that stalls on every attempt fails the item, the stage and the install — and commits nothing', async () => {
    stallsLeft = 2
    const { error, view } = await settleOperation({ plan: MEDIA_PLAN, resources: ['media-store'] }, (op) => installMediaStore(op, { fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe, stallTimeoutMs: 100 }))
    expect(String(error)).toMatch(/stall|no data/i)
    expect(view.status).toBe('failed')
    const download = view.stages.find((s) => s.id === 'download')!
    expect(download.status).toBe('failed')
    const libvips = download.items!.find((i) => i.id.includes('libvips'))!
    expect(libvips.status).toBe('failed')
    expect(libvips.message).toMatch(/stall|no data/i)
    expect(view.stages.slice(2).every((s) => s.status === 'pending')).toBe(true)
    expect(existsSync(mediaStoreDir())).toBe(false)
    stallsLeft = 0
  })
})

describe('media cancel boundaries (#895 SC3)', () => {
  function registry() {
    return createOperationRegistry({ bootId: () => 'b', publish: () => {}, quietCheckIntervalMs: 0, acquireResources: createMemoryResourceAcquirer(1) })
  }
  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((r) => { resolve = r })
    return { promise, resolve }
  }
  async function startInstall(reg: ReturnType<typeof registry>, opts: MediaInstallOptions) {
    return reg.start({
      kind: 'install:media', owner: 'core', origin: 'web', title: 'Install the media store', fingerprint: `m:${Math.random()}`,
      resources: ['media-store'], plan: MEDIA_PLAN,
      run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installMediaStore(op, opts) }),
    })
  }
  const settleCancelled = async (reg: ReturnType<typeof registry>, id: string) => {
    const view = await reg.await(id)
    expect(view.status).toBe('cancelled')
    expect(existsSync(mediaStoreDir())).toBe(false)
    const sharpRoot = join(testDir, 'media', 'sharp')
    expect(existsSync(sharpRoot) ? readdirSync(sharpRoot).filter((e) => e.startsWith('.staging-')) : []).toEqual([])
    reg.dispose()
  }

  it('cancel during the download aborts the transfer, commits nothing and cleans staging', async () => {
    const reg = registry()
    const gate = deferred()
    holdLibvips = gate.promise
    tarballRequests.length = 0
    try {
      const { operationId } = await startInstall(reg, { fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
      await waitUntil(() => tarballRequests.includes('/libvips.tgz'), { label: 'libvips requested' })
      expect(reg.cancel(operationId)).toBe('cancelling')
      gate.resolve()
      await settleCancelled(reg, operationId)
    } finally {
      holdLibvips = null
    }
  })

  for (const stage of ['bundle', 'verify'] as const) {
    it(`cancel during ${stage} stops before the commit`, async () => {
      const reg = registry()
      const entered = deferred()
      const release = deferred()
      const wait = async () => { entered.resolve(); await release.promise }
      const { operationId } = await startInstall(reg, {
        fetchImpl: nativeFetch,
        bundle: stage === 'bundle' ? async (e, o) => { await wait(); await fakeBundle(e, o) } : fakeBundle,
        probe: stage === 'verify' ? async () => { await wait() } : okProbe,
      })
      await entered.promise
      expect(reg.cancel(operationId)).toBe('cancelling')
      release.resolve()
      await settleCancelled(reg, operationId)
    })
  }

  it('once the commit starts, cancel is refused and the install finishes', async () => {
    let operationId = ''
    let cancelAnswer: string | undefined
    // Cancel at the exact moment the commit stage is announced.
    const reg = createOperationRegistry({
      bootId: () => 'b',
      quietCheckIntervalMs: 0,
      acquireResources: createMemoryResourceAcquirer(1),
      publish: (view) => {
        if (cancelAnswer === undefined && view.id === operationId && view.stages.find((s) => s.id === 'commit')?.status === 'active') {
          cancelAnswer = reg.cancel(operationId)
        }
      },
    })
    const started = await startInstall(reg, { fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    operationId = started.operationId
    const view = await reg.await(operationId)
    expect(cancelAnswer).toBe('not_cancellable')
    expect(view.status).toBe('succeeded')
    expect(existsSync(mediaStoreDir())).toBe(true)
    reg.dispose()
  })
})

describe('media exclusion (#895 SC6)', () => {
  it('a repair, a local (onboarding) install and another process run one at a time, waiting visibly, never sharing staging', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = nativeFetch
    const lockPath = resourceLockPath('media-store')
    mkdirSync(join(lockPath, '..'), { recursive: true })
    // Another process (alive, not us) holds the store install.
    writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, acquiredAt: new Date().toISOString(), title: 'bakin install media (another process)' }))
    tarballRequests.length = 0
    const repairRegistry = createOperationRegistry({ bootId: () => 'b', publish: () => {}, quietCheckIntervalMs: 0, resourcePollMs: { initial: 10, max: 20 } })
    try {
      const repair = await repairRegistry.start({
        kind: 'repair:media', owner: 'core', origin: 'web', title: 'Install the media store (repair)', fingerprint: 'repair-media',
        resources: ['media-store'], plan: MEDIA_PLAN,
        run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installMediaStore(op, { fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe }) }),
      })
      // This process's registry — where an in-process `bakin install media` runs.
      const localStart = await getOperationRegistry().start({
        kind: 'onboarding:media', owner: 'core', origin: 'cli', title: 'Install the media store', fingerprint: 'onboarding-media',
        resources: ['media-store'], plan: MEDIA_PLAN,
        run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installMediaStore(op, { fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe }) }),
      })
      const local = getOperationRegistry().await(localStart.operationId).then((view) => view.result!.body as { skipped: boolean })
      await waitUntil(() => repairRegistry.get(repair.operationId)?.waitingFor?.holderTitle === 'bakin install media (another process)', { label: 'repair waits on the other process' })
      await waitUntil(() => getOperationRegistry().list().some((op) => op.waitingFor !== undefined), { label: 'local install waits visibly' })
      expect(tarballRequests).toEqual([])

      rmSync(lockPath)
      const [repairView, localResult] = await Promise.all([repairRegistry.await(repair.operationId), local])
      expect(repairView.status).toBe('succeeded')
      // Exactly one of them downloaded; the other found the store installed.
      expect(tarballRequests.filter((p) => p === '/sharp.tgz')).toHaveLength(1)
      const repairSkipped = (repairView.result?.body as { skipped: boolean }).skipped
      expect([repairSkipped, localResult.skipped].sort()).toEqual([false, true])
      expect(checkMediaStore().status).toBe('ok')
    } finally {
      globalThis.fetch = originalFetch
      repairRegistry.dispose()
      _resetOperationRegistryForTests()
      if (existsSync(lockPath)) rmSync(lockPath)
    }
  })
})

describe('checkMediaStore', () => {
  it('reports missing when nothing is installed', () => {
    expect(checkMediaStore().status).toBe('missing')
  })

  it('reports missing when the receipt is for another sharp version', async () => {
    await mediaInstall({ fetchImpl: nativeFetch, bundle: fakeBundle, probe: okProbe })
    const receiptPath = join(mediaStoreDir(), 'receipt.json')
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8')) as { sharpVersion: string }
    receipt.sharpVersion = '0.0.0-other'
    writeFileSync(receiptPath, JSON.stringify(receipt))
    expect(checkMediaStore().status).toBe('missing')
  })
})
