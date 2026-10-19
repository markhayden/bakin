/**
 * npm-payload + model requirement legs (pi-ecosystem WS2 T2.2) — the
 * bin-survival discipline applied to the new legs: install, upgrade
 * survival, fail-fast teardown ordering, offline local repair, dropped-leg
 * sweeps with refcounted sharing, and uninstall.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-req-legs-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { installFilesystemRuntimeAppServices } from '../helpers/runtime-app-services'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('@/core/task-store', () => ({}))

// bun-install spy: creates node_modules at the cwd like the real run would;
// the real system-bun mechanics are whiskit's tested territory.
let bunRuns: Array<{ args: string[]; cwd: string; extraEnv?: Record<string, string> }> = []
/** What the fake install actually lands (a misbehaving bun); null = the declared set. */
let bunInstallOverride: Record<string, string> | null = null
mock.module('../../src/core/whiskit/command', () => ({
  runSystemBun: async (args: string[], options: { cwd: string; extraEnv?: Record<string, string>; onLine?: (line: string) => void }) => {
    bunRuns.push({ args, cwd: options.cwd, extraEnv: options.extraEnv })
    options.onLine?.('+ fake-dep@1.0.0')
    // Install exactly what the generated package.json declares — name,
    // version and an entry file — like the real run (verifyNpmPayload, #898 F).
    const declared = JSON.parse(readFileSync(join(options.cwd, 'package.json'), 'utf-8')) as { dependencies: Record<string, string> }
    for (const [name, version] of Object.entries(bunInstallOverride ?? declared.dependencies)) {
      const dir = join(options.cwd, 'node_modules', ...name.split('/'))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }))
      writeFileSync(join(dir, 'index.js'), 'export default 1\n')
    }
    return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1 }
  },
}))

import { installPackage as installPackageUnowned } from '../../src/core/agent-packages/installer'
import { updatePackageById as updatePackageByIdUnowned } from '../../src/core/agent-packages/updater'
import { repairPackLocally as repairUnowned } from '../../src/core/agent-packages/sync'
import { removePackageById as removePackageByIdUnowned } from '../../src/core/agent-packages/uninstaller'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { parseManifest } from '../../packages/core/src/agent-packages/manifest'
import { installManifestRequirements as installManifestRequirementsUnowned } from '../../src/core/agent-packages/requirements-installer'
import { settleOperation } from '../helpers/operation-harness'
import { holdNow } from '../../packages/core/src/operations'
import { owned } from '../helpers/owning'

// The core install writers assert install-state ownership (#895): call them as an owner.
const installPackage = owned(installPackageUnowned)
const updatePackageById = owned(updatePackageByIdUnowned)
const removePackageById = owned(removePackageByIdUnowned)
const installManifestRequirements = owned(installManifestRequirementsUnowned)

/** Writing syncs run inside an owner of install-state, like every production caller (#895). */
const owning = <T>(fn: () => Promise<T>): Promise<T> => holdNow(['install-state'], { title: 'test' }, fn)
const repairPackLocally = (...args: Parameters<typeof repairUnowned>) => owning(() => repairUnowned(...args))

const MODEL_BYTES = 'FAKE-GGUF-MODEL-CONTENT-0123456789'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
const bunServe = (Bun as unknown as {
  serve: (opts: { port: number; fetch: (req: Request) => Response }) => { port: number; stop: (force?: boolean) => void }
}).serve

let server: { port: number; stop: (force?: boolean) => void }
let hits: Record<string, number> = {}

beforeAll(() => {
  server = bunServe({
    port: 0,
    fetch(req: Request) {
      const path = new URL(req.url).pathname
      hits[path] = (hits[path] ?? 0) + 1
      if (path === '/model.gguf') return new NativeResponse(MODEL_BYTES)
      return new NativeResponse('?', { status: 404 })
    },
  })
})

afterAll(() => {
  server.stop(true)
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  hits = {}
  bunRuns = []
  bunInstallOverride = null
  installFilesystemRuntimeAppServices({ openClawDir, agents: () => [] })
})

function seedPack(version: string, opts: {
  id?: string
  npm?: boolean
  npmDeps?: Record<string, string>
  model?: boolean
  modelUrl?: string
  modelSha?: string
} = {}): string {
  const id = opts.id ?? 'toolpack'
  const dir = join(testDir, `${id}-src`)
  rmSync(dir, { recursive: true, force: true })
  const skillName = `use-${id}`
  mkdirSync(join(dir, 'skills', skillName), { recursive: true })
  writeFileSync(join(dir, 'skills', skillName, 'SKILL.md'), `# ${skillName} ${version}`)
  if (opts.npm !== false) {
    mkdirSync(join(dir, 'payload', 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'payload', 'scripts', 'run.js'), `// ${version}\nconsole.log('run')\n`)
  }
  writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({
    id,
    kind: 'skill-pack',
    name: id,
    version,
    capability: `cap-${id}`,
    contributions: { skills: [`skills/${skillName}`] },
    requires: {
      ...(opts.npm !== false ? {
        npm: [{ name: 'scripts', source: 'payload/scripts', dependencies: opts.npmDeps ?? {}, env: { PUPPETEER_SKIP_DOWNLOAD: '1' } }],
      } : {}),
      ...(opts.model !== false ? {
        models: [{
          name: 'fakemodel',
          url: opts.modelUrl ?? `http://127.0.0.1:${server.port}/model.gguf`,
          sha256: opts.modelSha ?? sha256(MODEL_BYTES),
          bytes: MODEL_BYTES.length,
          dest: `${id}/model.gguf`,
        }],
      } : {}),
    },
  }))
  return dir
}

const payloadDir = (id = 'toolpack') => join(testDir, 'npm', id, 'scripts')
const modelFile = (id = 'toolpack') => join(testDir, 'models', id, 'model.gguf')
const packRows = (key = 'toolpack@1.0.0') => readLockfile().packages[key]!.projections!

describe('npm payload leg', () => {
  it('installs scripts + generated package.json out-of-band and records the projection', async () => {
    await installPackage({ source: seedPack('1.0.0', { model: false }) })
    expect(readFileSync(join(payloadDir(), 'run.js'), 'utf-8')).toContain('1.0.0')
    const pkg = JSON.parse(readFileSync(join(payloadDir(), 'package.json'), 'utf-8'))
    expect(pkg.private).toBe(true)
    expect(bunRuns).toHaveLength(0) // zero-dep payload: vendored scripts, no install run
    expect(packRows().filter((p) => p.kind === 'npm-payload')).toHaveLength(1)
  })

  it('runs bun install --ignore-scripts with declared env when deps exist, and skips it on unchanged local repair (offline-safe)', async () => {
    await installPackage({ source: seedPack('1.0.0', { model: false, npmDeps: { 'fake-dep': '1.2.3' } }) })
    expect(bunRuns).toHaveLength(1)
    // A payload-local layout whatever any bunfig says — the CLI flag overrides config (#898 F review).
    expect(bunRuns[0]!.args).toEqual(['install', '--ignore-scripts', '--linker=hoisted'])
    expect(bunRuns[0]!.extraEnv).toEqual({ PUPPETEER_SKIP_DOWNLOAD: '1' })

    rmSync(join(payloadDir(), 'run.js'), { force: true }) // drift the scripts
    await repairPackLocally('toolpack@1.0.0')
    expect(existsSync(join(payloadDir(), 'run.js'))).toBe(true) // scripts restored
    expect(bunRuns).toHaveLength(1) // unchanged deps + node_modules present → NO second install
  })

  it('a pack\'s own bunfig is copied verbatim (registries/scopes stay in force); the layout rides the CLI flag', async () => {
    const src = seedPack('1.0.0', { model: false, npmDeps: { 'fake-dep': '1.2.3' } })
    const packBunfig = '[install]\n"linker" = "isolated"\nregistry = "https://registry.example"\n\n[install.scopes]\n"@acme" = { url = "https://npm.acme.dev", token = "$ACME_TOKEN" }\n'
    writeFileSync(join(src, 'payload', 'scripts', 'bunfig.toml'), packBunfig)
    await installPackage({ source: src })
    expect(readFileSync(join(payloadDir(), 'bunfig.toml'), 'utf-8')).toBe(packBunfig)
    expect(bunRuns.at(-1)!.args).toContain('--linker=hoisted')
  })

  it('reuse needs PROOF: a live payload whose dependency no longer resolves at its pin is reinstalled, not reused (#898 F)', async () => {
    await installPackage({ source: seedPack('1.0.0', { model: false, npmDeps: { 'fake-dep': '1.2.3' } }) })
    expect(bunRuns).toHaveLength(1)
    // node_modules still exists, package.json unchanged — but the dependency was swapped.
    writeFileSync(join(payloadDir(), 'node_modules', 'fake-dep', 'package.json'), JSON.stringify({ name: 'fake-dep', version: '9.9.9', main: 'index.js' }))
    await repairPackLocally('toolpack@1.0.0')
    expect(bunRuns).toHaveLength(2)
    expect(JSON.parse(readFileSync(join(payloadDir(), 'node_modules', 'fake-dep', 'package.json'), 'utf-8')).version).toBe('1.2.3')
  })

  it('an install that does not resolve the declared versions fails and never replaces the live payload', async () => {
    await installPackage({ source: seedPack('1.0.0', { model: false, npmDeps: { 'fake-dep': '1.2.3' } }) })
    const liveDep = join(payloadDir(), 'node_modules', 'fake-dep', 'package.json')
    rmSync(join(payloadDir(), 'node_modules'), { recursive: true, force: true })
    bunInstallOverride = { 'fake-dep': '0.0.1' } // the run "succeeds" with the wrong version
    const { installNpmRequirement } = await import('../../src/core/agent-packages/requirements-installer')
    const src = join(testDir, 'packages', 'skill-packs', 'toolpack@1.0.0')
    const req = { name: 'scripts', source: 'payload/scripts', dependencies: { 'fake-dep': '1.2.3' } }
    await expect(installNpmRequirement(req, 'toolpack', src, { package: 'toolpack', version: '1.0.0', ref: '', commitSha: '', installedAt: new Date().toISOString() }))
      .rejects.toThrow(/did not resolve at the declared versions.*fake-dep is 0\.0\.1, not the declared 1\.2\.3/)
    expect(existsSync(liveDep)).toBe(false) // the bad staged tree never replaced the live payload
    // The local repair (which logs leg failures rather than throwing) lands nothing bad either.
    await repairPackLocally('toolpack@1.0.0')
    expect(existsSync(liveDep)).toBe(false)
  })

  it('a dropped npm leg is swept on upgrade; a kept one survives', async () => {
    await installPackage({ source: seedPack('1.0.0', { model: false, npmDeps: { 'fake-dep': '1.2.3' } }) })
    expect(existsSync(payloadDir())).toBe(true)

    seedPack('2.0.0', { npm: false, model: false })
    await updatePackageById({ packageId: 'toolpack@1.0.0' })
    expect(existsSync(payloadDir())).toBe(false)
  })
})

describe('model leg', () => {
  it('downloads, sha-verifies, and fast-paths an unchanged pin across upgrades', async () => {
    await installPackage({ source: seedPack('1.0.0', { npm: false }) })
    expect(readFileSync(modelFile(), 'utf-8')).toBe(MODEL_BYTES)
    expect(hits['/model.gguf']).toBe(1)

    seedPack('1.0.1', { npm: false })
    await updatePackageById({ packageId: 'toolpack@1.0.0' })
    expect(hits['/model.gguf']).toBe(1) // hash matches the pin — no re-download
    expect(readLockfile().packages['toolpack@1.0.0']!.version).toBe('1.0.1')
  })

  it('same-size corruption under an intact marker defeats the skip — the repair re-downloads (#898 E)', async () => {
    await installPackage({ source: seedPack('1.0.0', { npm: false }) })
    expect(hits['/model.gguf']).toBe(1)
    const { atime, mtime } = require('fs').statSync(modelFile())
    const corrupt = MODEL_BYTES.slice(0, -1) + (MODEL_BYTES.endsWith('x') ? 'y' : 'x')
    writeFileSync(modelFile(), corrupt) // same length, marker untouched
    require('fs').utimesSync(modelFile(), atime, mtime)
    await repairPackLocally('toolpack@1.0.0')
    expect(hits['/model.gguf']).toBe(2)
    expect(readFileSync(modelFile(), 'utf-8')).toBe(MODEL_BYTES)
  })

  it('repairPackLocally restores a deleted model', async () => {
    await installPackage({ source: seedPack('1.0.0', { npm: false }) })
    rmSync(modelFile(), { force: true })
    await repairPackLocally('toolpack@1.0.0')
    expect(readFileSync(modelFile(), 'utf-8')).toBe(MODEL_BYTES)
  })

  it('a failed model download aborts the upgrade before any teardown', async () => {
    await installPackage({ source: seedPack('1.0.0', { npm: false }) })
    const skillPath = join(openClawDir, 'skills', 'use-toolpack', 'SKILL.md')
    const skillBefore = readFileSync(skillPath, 'utf-8')

    // New version changes the PIN (so the fast path can't skip) and the URL is dead.
    seedPack('2.0.0', { npm: false, modelUrl: `http://127.0.0.1:${server.port}/missing.gguf`, modelSha: sha256('new-model-bytes') })
    await expect(updatePackageById({ packageId: 'toolpack@1.0.0' })).rejects.toThrow(/download failed/)
    expect(readLockfile().packages['toolpack@1.0.0']!.version).toBe('1.0.0')
    expect(readFileSync(skillPath, 'utf-8')).toBe(skillBefore)
    expect(readFileSync(modelFile(), 'utf-8')).toBe(MODEL_BYTES)
  })

  it('offline local repair keeps model rows tracked when the download fails', async () => {
    await installPackage({ source: seedPack('1.0.0', { npm: false }) })
    // Simulate offline: installed manifest now points at a dead URL, model gone.
    const installed = join(testDir, 'packages', 'skill-packs', 'toolpack@1.0.0', 'bakin-package.json')
    const manifest = JSON.parse(readFileSync(installed, 'utf-8'))
    manifest.requires.models[0].url = `http://127.0.0.1:${server.port}/missing.gguf`
    writeFileSync(installed, JSON.stringify(manifest))
    rmSync(modelFile(), { force: true })

    await repairPackLocally('toolpack@1.0.0') // must NOT throw
    expect(existsSync(modelFile())).toBe(false)
    expect(packRows().filter((p) => p.kind === 'model')).toHaveLength(1) // still tracked
  })

  it('a model two packs share survives removal of one and dies with the last', async () => {
    // Same dest via same id-prefix trick: both packs declare dest under a shared name.
    const a = seedPack('1.0.0', { npm: false })
    const aManifest = JSON.parse(readFileSync(join(a, 'bakin-package.json'), 'utf-8'))
    aManifest.requires.models[0].dest = 'shared/model.gguf'
    writeFileSync(join(a, 'bakin-package.json'), JSON.stringify(aManifest))
    await installPackage({ source: a })

    const b = seedPack('1.0.0', { id: 'otherpack', npm: false })
    const bManifest = JSON.parse(readFileSync(join(b, 'bakin-package.json'), 'utf-8'))
    bManifest.requires.models[0].dest = 'shared/model.gguf'
    writeFileSync(join(b, 'bakin-package.json'), JSON.stringify(bManifest))
    await installPackage({ source: b })

    const shared = join(testDir, 'models', 'shared', 'model.gguf')
    expect(existsSync(shared)).toBe(true)

    await removePackageById({ packageId: 'toolpack@1.0.0' })
    expect(existsSync(shared)).toBe(true) // otherpack still projects it

    await removePackageById({ packageId: 'otherpack@1.0.0' })
    expect(existsSync(shared)).toBe(false) // last reference gone
  })
})

describe('uninstall', () => {
  it('removes the npm payload dir and unshared model with the pack', async () => {
    await installPackage({ source: seedPack('1.0.0', { npmDeps: { 'fake-dep': '1.2.3' } }) })
    expect(existsSync(payloadDir())).toBe(true)
    expect(existsSync(modelFile())).toBe(true)

    await removePackageById({ packageId: 'toolpack@1.0.0' })
    expect(existsSync(payloadDir())).toBe(false)
    expect(existsSync(modelFile())).toBe(false)
  })
})

describe('model env boot injection', () => {
  it('injects {dest}-expanded env vars for installed packs, env-first', async () => {
    const src = seedPack('1.0.0', { npm: false })
    const manifest = JSON.parse(readFileSync(join(src, 'bakin-package.json'), 'utf-8'))
    manifest.requires.models[0].env = { FAKE_MODEL_PATH: '{dest}', FAKE_MODEL_MODE: 'q8' }
    writeFileSync(join(src, 'bakin-package.json'), JSON.stringify(manifest))
    await installPackage({ source: src })

    delete process.env.FAKE_MODEL_PATH
    process.env.FAKE_MODEL_MODE = 'user-set'
    try {
      const { injectPackModelEnv } = await import('../../src/core/secret-env')
      const injected = injectPackModelEnv()
      expect(injected).toEqual(['FAKE_MODEL_PATH'])
      expect(process.env.FAKE_MODEL_PATH ?? '').toBe(modelFile())
      expect(process.env.FAKE_MODEL_MODE).toBe('user-set') // env-first: never overwritten
    } finally {
      delete process.env.FAKE_MODEL_PATH
      delete process.env.FAKE_MODEL_MODE
    }
  })
})

describe('capability readiness — new legs', () => {
  it('reports missing npm/model legs with sync remediation, and platform gating honestly', async () => {
    const src = seedPack('1.0.0', { npmDeps: { 'fake-dep': '1.2.3' } })
    const manifest = JSON.parse(readFileSync(join(src, 'bakin-package.json'), 'utf-8'))
    manifest.requires.prereqs = [
      { name: 'definitely-not-a-real-binary-xyz', kind: 'binary', probe: 'definitely-not-a-real-binary-xyz', help: 'https://example.dev' },
    ]
    writeFileSync(join(src, 'bakin-package.json'), JSON.stringify(manifest))
    await installPackage({ source: src })

    rmSync(join(testDir, 'npm', 'toolpack'), { recursive: true, force: true })
    rmSync(modelFile(), { force: true })

    const { listCapabilities } = await import('../../src/core/agent-packages/capability-readiness')
    const [cap] = await listCapabilities()
    expect(cap!.ready).toBe(false)
    expect(cap!.npm[0]!.status).toBe('missing')
    expect(cap!.models[0]!.status).toBe('missing')
    expect(cap!.prereqs[0]!.status).toBe('missing')
    expect(cap!.platformSupported).toBe(true)
    expect(cap!.missing.join('\n')).toContain('bakin packages sync toolpack@1.0.0')
    expect(cap!.missing.join('\n')).toContain('https://example.dev')
  })

  it('an installed npm payload whose dependency drifted from its pin is unresolved, never ok (#898 F)', async () => {
    await installPackage({ source: seedPack('1.0.0', { model: false, npmDeps: { 'fake-dep': '1.2.3' } }) })
    const { listCapabilities } = await import('../../src/core/agent-packages/capability-readiness')
    let [cap] = await listCapabilities()
    expect(cap!.npm).toEqual([{ name: 'scripts', status: 'ok' }])
    writeFileSync(join(payloadDir(), 'node_modules', 'fake-dep', 'package.json'), JSON.stringify({ name: 'fake-dep', version: '2.0.0', main: 'index.js' }))
    ;[cap] = await listCapabilities()
    expect(cap!.npm).toEqual([{ name: 'scripts', status: 'unresolved' }])
    expect(cap!.missing.join('\n')).toMatch(/does not resolve at the declared versions.*fake-dep is 2\.0\.0.*bakin packages sync/)
    expect(cap!.missing.join('\n')).not.toMatch(/integrity/i)
  })

  it('a pack whose platforms become incompatible AFTER install reports platform, not per-leg noise', async () => {
    // D14 refuses wrong-platform installs outright, so readiness's platform
    // leg now guards the post-install drift case: the INSTALLED manifest
    // (e.g. edited by an update fetched on another machine) excludes this
    // platform.
    const src = seedPack('1.0.0', { npm: false, model: false })
    await installPackage({ source: src })
    const installedManifest = join(testDir, 'packages', 'skill-packs', 'toolpack@1.0.0', 'bakin-package.json')
    const manifest = JSON.parse(readFileSync(installedManifest, 'utf-8'))
    manifest.platforms = process.platform === 'darwin' ? ['linux-x64'] : ['darwin-arm64']
    writeFileSync(installedManifest, JSON.stringify(manifest))

    const { listCapabilities } = await import('../../src/core/agent-packages/capability-readiness')
    const [cap] = await listCapabilities()
    expect(cap!.platformSupported).toBe(false)
    expect(cap!.ready).toBe(false)
    expect(cap!.missing.join('\n')).toContain('not available on this platform')
  })
})

describe('review hardening pins', () => {
  it('npmPayloadDir refuses traversal-shaped package ids', async () => {
    const { npmPayloadDir } = await import('../../src/core/agent-packages/requirements-installer')
    expect(() => npmPayloadDir('../../..', 'documents')).toThrow(/not a safe id/)
  })

  it('a failed model leg during upgrade leaves the LIVE npm payload untouched', async () => {
    await installPackage({ source: seedPack('1.0.0', { npmDeps: { 'fake-dep': '1.2.3' } }) })
    const scriptBefore = readFileSync(join(payloadDir(), 'run.js'), 'utf-8')
    expect(scriptBefore).toContain('1.0.0')

    // v2 changes scripts AND breaks the model pin — npm runs last, so the
    // payload must never have been touched when the model leg aborts.
    seedPack('2.0.0', { npmDeps: { 'fake-dep': '1.2.3' }, modelUrl: `http://127.0.0.1:${server.port}/missing.gguf`, modelSha: sha256('changed') })
    await expect(updatePackageById({ packageId: 'toolpack@1.0.0' })).rejects.toThrow(/download failed/)
    expect(readFileSync(join(payloadDir(), 'run.js'), 'utf-8')).toBe(scriptBefore)
  })

  it('a second pack pinning a DIFFERENT sha at the same model dest is refused, never clobbered', async () => {
    const a = seedPack('1.0.0', { npm: false })
    const aM = JSON.parse(readFileSync(join(a, 'bakin-package.json'), 'utf-8'))
    aM.requires.models[0].dest = 'shared/model.gguf'
    writeFileSync(join(a, 'bakin-package.json'), JSON.stringify(aM))
    await installPackage({ source: a })
    const bytesBefore = readFileSync(join(testDir, 'models', 'shared', 'model.gguf'), 'utf-8')

    const b = seedPack('1.0.0', { id: 'otherpack', npm: false, modelSha: sha256('a-different-model') })
    const bM = JSON.parse(readFileSync(join(b, 'bakin-package.json'), 'utf-8'))
    bM.requires.models[0].dest = 'shared/model.gguf'
    writeFileSync(join(b, 'bakin-package.json'), JSON.stringify(bM))
    await expect(installPackage({ source: b })).rejects.toThrow(/different sha256 pin/)
    expect(readFileSync(join(testDir, 'models', 'shared', 'model.gguf'), 'utf-8')).toBe(bytesBefore)
  })

  it('a platforms-gated pack on the wrong platform REFUSES install — no legs, no downloads (D14)', async () => {
    const src = seedPack('1.0.0', {})
    const m = JSON.parse(readFileSync(join(src, 'bakin-package.json'), 'utf-8'))
    // Whatever platform runs this test, declare the OTHER one.
    m.platforms = [process.platform === 'darwin' ? 'linux-arm64' : 'darwin-arm64']
    writeFileSync(join(src, 'bakin-package.json'), JSON.stringify(m))
    await expect(installPackage({ source: src })).rejects.toThrow(/not available on this platform/)
    expect(existsSync(payloadDir())).toBe(false)
    expect(existsSync(modelFile())).toBe(false)
    expect(hits['/model.gguf'] ?? 0).toBe(0) // no pointless download
  })

  it('a payload source carrying its own package.json never defeats the offline skip', async () => {
    const src = seedPack('1.0.0', { model: false, npmDeps: { 'fake-dep': '1.2.3' } })
    writeFileSync(join(src, 'payload', 'scripts', 'package.json'), '{"name":"upstream-junk"}')
    await installPackage({ source: src })
    expect(JSON.parse(readFileSync(join(payloadDir(), 'package.json'), 'utf-8')).name).toContain('bakin-pack')
    expect(bunRuns).toHaveLength(1)

    await repairPackLocally('toolpack@1.0.0')
    expect(bunRuns).toHaveLength(1) // still offline-skipped
  })
})

describe('sync scanner vs requirement legs', () => {
  it('npm payloads and models never report asset drift (readiness owns those legs)', async () => {
    await installPackage({ source: seedPack('1.0.0', { npmDeps: { 'fake-dep': '1.2.3' } }) })
    const { scanAgentSync } = await import('../../src/core/agent-packages/sync-scanner')
    const report = await scanAgentSync()
    const legFindings = report.findings.filter((f) =>
      String(f.target ?? '').includes('/npm/') || String(f.target ?? '').includes('/models/'))
    expect(legFindings).toEqual([])
  })
})

describe('operation reporting (#895)', () => {
  const plan = { stages: [{ id: 'requirements', kind: 'installing' as const, label: 'Install requirements' }], pointOfNoReturn: 'requirements' }
  const installedBy = { package: 'toolpack', version: '1.0.0', ref: '', commitSha: '', installedAt: new Date().toISOString() }
  const legsOf = (dir: string) => parseManifest(JSON.parse(readFileSync(join(dir, 'bakin-package.json'), 'utf-8')))
  const run = (dir: string) => settleOperation({ plan, resources: ['install-state'] }, async (op) => {
    op.stage('requirements')
    await installManifestRequirements({
      manifest: legsOf(dir), packId: 'toolpack', sourceDir: dir, installedBy, result: { projections: [] },
      op: { op, stageId: 'requirements' }, modelOptions: { fetchImpl: nativeFetch },
    })
  })

  it('lists every leg up front, then reports each as an item with the model bytes and bun output as liveness', async () => {
    const dir = seedPack('1.0.0', { npmDeps: { 'fake-dep': '1.0.0' } })
    const { error, view } = await run(dir)
    expect(error).toBeUndefined()
    const items = view.stages[0]!.items ?? []
    expect(items.map((i) => [i.id, i.status])).toEqual([['model:fakemodel', 'done'], ['npm:scripts', 'done']])
    expect(items[0]!.bytes).toEqual({ received: MODEL_BYTES.length, total: MODEL_BYTES.length })
    expect(view.lastOutput).toBe('+ fake-dep@1.0.0')
  })

  it('a leg already at its pin is a skipped item, not a download', async () => {
    const dir = seedPack('1.0.0', { npm: false })
    await run(dir)
    hits = {}
    const { view } = await run(dir)
    expect(view.stages[0]!.items?.map((i) => [i.id, i.status])).toEqual([['model:fakemodel', 'skipped']])
    expect(hits['/model.gguf']).toBeUndefined()
  })

  it('a failed leg is a failed item carrying the error, and the error is rethrown', async () => {
    const dir = seedPack('1.0.0', { npm: false, modelUrl: `http://127.0.0.1:${server.port}/gone.gguf` })
    const { error, view } = await run(dir)
    expect(String(error)).toMatch(/404/)
    const item = view.stages[0]!.items?.[0]
    expect(item?.status).toBe('failed')
    expect(item?.message).toMatch(/404/)
    expect(view.status).toBe('failed')
  })
})
