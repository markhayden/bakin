/**
 * Capability-pack binaries must survive every projection pass, not just
 * install. Regression: `bakin packages sync` on a version bump ran the
 * updater's unproject sweep (which deletes `bin` projections) and then
 * re-projected WITHOUT reinstalling bins — every capability-pack upgrade
 * silently deleted its binaries (found live: web-search-brave 1.0.0→1.0.1
 * removed ~/.bakin/bin/bx). Pins:
 *   - updatePackageById keeps a still-declared bin on disk (no re-download
 *     when the pin is unchanged) and re-records it in the lockfile
 *   - updatePackageById re-downloads when the new version changes the pin
 *   - repairPackLocally restores a deleted binary (local repair = full leg)
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-bin-survival-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { installFilesystemRuntimeAppServices } from '../helpers/runtime-app-services'

const binDir = join(testDir, 'bin')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: binDir, db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: binDir, db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('@/core/task-store', () => ({}))

import { installPackage } from '../../src/core/agent-packages/installer'
import { updatePackageById } from '../../src/core/agent-packages/updater'
import { repairPackLocally } from '../../src/core/agent-packages/sync'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'
import { binPlatformKey } from '../../src/core/agent-packages/bin-installer'

// Real executables: POSIX sh scripts whose --version exits 0.
const SCRIPT_V1 = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fixture 1.0.0"; exit 0; fi\nexit 1\n'
const SCRIPT_V2 = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fixture 2.0.0"; exit 0; fi\nexit 1\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// Real sockets need the native Response/fetch pair (happy-dom preload
// replaces the globals) — same recovery as bin-installer.test.ts.
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
      if (path === '/v1') return new NativeResponse(SCRIPT_V1)
      if (path === '/v2') return new NativeResponse(SCRIPT_V2)
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
  installFilesystemRuntimeAppServices({ openClawDir, agents: () => [] })
})

const platformKey = binPlatformKey()
if (!platformKey) throw new Error('unsupported test platform')

function seedCapabilityPack(
  version: string,
  urlPath: string,
  script: string,
  opts: { id?: string; bins?: boolean } = {},
): string {
  const id = opts.id ?? 'websearch'
  const dir = join(testDir, `${id}-pack`)
  const skillName = `find-stuff-${id}`
  mkdirSync(join(dir, 'skills', skillName), { recursive: true })
  writeFileSync(join(dir, 'skills', skillName, 'SKILL.md'), `# ${skillName} ${version}\n\nSearch.`)
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'skill-pack',
      name: id,
      version,
      capability: `web-search-${id}`,
      contributions: { skills: [`skills/${skillName}`] },
      ...(opts.bins === false ? {} : {
        requires: {
          bins: [{
            name: 'fixturebin',
            version,
            install: { [platformKey!]: { url: `http://127.0.0.1:${server.port}${urlPath}`, sha256: sha256(script) } },
            verifyArgs: ['--version'],
          }],
        },
      }),
    }),
  )
  return dir
}

const binTarget = () => join(binDir, 'fixturebin')
const lockBins = () =>
  (readLockfile().packages['websearch@' + JSON.parse(readFileSync(join(testDir, 'websearch-pack', 'bakin-package.json'), 'utf-8')).version]
    ?? Object.values(readLockfile().packages)[0])!
    .projections!.filter((p) => p.kind === 'bin')

describe('capability-pack bins survive projection passes', () => {
  it('version upgrade keeps an unchanged-pin bin on disk without re-downloading', async () => {
    const src = seedCapabilityPack('1.0.0', '/v1', SCRIPT_V1)
    await installPackage({ source: src })
    expect(existsSync(binTarget())).toBe(true)
    expect(hits['/v1']).toBe(1)

    seedCapabilityPack('1.0.1', '/v1', SCRIPT_V1) // description-only style bump: same bin pin
    const result = await updatePackageById({ packageId: 'websearch@1.0.0' })
    expect(result.changed).toBe(true)

    expect(existsSync(binTarget())).toBe(true)
    expect(hits['/v1']).toBe(1) // sha fast path — never re-downloaded
    expect(lockBins()).toHaveLength(1) // still tracked for uninstall
  })

  it('version upgrade with a new pin re-downloads the binary', async () => {
    const src = seedCapabilityPack('1.0.0', '/v1', SCRIPT_V1)
    await installPackage({ source: src })

    seedCapabilityPack('2.0.0', '/v2', SCRIPT_V2)
    await updatePackageById({ packageId: 'websearch@1.0.0' })

    expect(readFileSync(binTarget(), 'utf-8')).toBe(SCRIPT_V2)
    expect(hits['/v2']).toBe(1)
  })

  it('repairPackLocally restores a deleted binary', async () => {
    const src = seedCapabilityPack('1.0.0', '/v1', SCRIPT_V1)
    await installPackage({ source: src })

    rmSync(binTarget(), { force: true })
    expect(existsSync(binTarget())).toBe(false)

    await repairPackLocally('websearch@1.0.0')
    expect(existsSync(binTarget())).toBe(true)
    expect(readFileSync(binTarget(), 'utf-8')).toBe(SCRIPT_V1)
    expect(lockBins()).toHaveLength(1)
  })

  it('a dropped bin another pack still projects survives the upgrade (shared-bin guard)', async () => {
    await installPackage({ source: seedCapabilityPack('1.0.0', '/v1', SCRIPT_V1) })
    await installPackage({ source: seedCapabilityPack('1.0.0', '/v1', SCRIPT_V1, { id: 'otherpack' }) })
    expect(existsSync(binTarget())).toBe(true)

    seedCapabilityPack('2.0.0', '/v1', SCRIPT_V1, { bins: false }) // websearch 2.0.0 drops the bin
    await updatePackageById({ packageId: 'websearch@1.0.0' })

    expect(existsSync(binTarget())).toBe(true) // otherpack still projects it
    const other = readLockfile().packages['otherpack@1.0.0']!
    expect(other.projections!.filter((p) => p.kind === 'bin')).toHaveLength(1)
  })

  it('a failed bin download aborts the upgrade BEFORE any state is torn down', async () => {
    await installPackage({ source: seedCapabilityPack('1.0.0', '/v1', SCRIPT_V1) })
    const skillBefore = readFileSync(
      join(openClawDir, 'skills', 'find-stuff-websearch', 'SKILL.md'), 'utf-8')

    seedCapabilityPack('2.0.0', '/missing', SCRIPT_V2) // new pin, unreachable URL
    await expect(updatePackageById({ packageId: 'websearch@1.0.0' })).rejects.toThrow(/download failed/)

    // Nothing was unprojected, projected, or lockfile-flipped.
    expect(readLockfile().packages['websearch@1.0.0']!.version).toBe('1.0.0')
    expect(readFileSync(join(openClawDir, 'skills', 'find-stuff-websearch', 'SKILL.md'), 'utf-8')).toBe(skillBefore)
    expect(readFileSync(binTarget(), 'utf-8')).toBe(SCRIPT_V1)
    expect(lockBins()).toHaveLength(1)
  })

  it('offline local repair still repairs skills and keeps bin rows tracked (best-effort bins)', async () => {
    await installPackage({ source: seedCapabilityPack('1.0.0', '/v1', SCRIPT_V1) })

    // Simulate offline: the installed source's pin now points at a dead URL,
    // and the binary is gone from disk.
    const installedManifest = join(testDir, 'packages', 'skill-packs', 'websearch@1.0.0', 'bakin-package.json')
    const manifest = JSON.parse(readFileSync(installedManifest, 'utf-8'))
    manifest.requires.bins[0].install[platformKey!].url = `http://127.0.0.1:${server.port}/missing`
    writeFileSync(installedManifest, JSON.stringify(manifest))
    rmSync(binTarget(), { force: true })

    await repairPackLocally('websearch@1.0.0') // must NOT throw
    expect(existsSync(binTarget())).toBe(false) // honestly still missing
    expect(lockBins()).toHaveLength(1) // previous row kept — still tracked for uninstall
  })
})
