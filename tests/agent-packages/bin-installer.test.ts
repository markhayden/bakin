/**
 * Pinned binary installer (capability packs, T2.2).
 *
 * Real-HTTP tests over a local Bun.serve fixture (per CLAUDE.md: real
 * sockets need Bun.fetch — the happy-dom fetch replacement breaks them).
 */
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, mock } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-bin-installer-${Date.now()}-${Math.random().toString(16).slice(2)}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { binPlatformKey, installBinRequirement, installPluginBins } from '../../src/core/agent-packages/bin-installer'
import { settleOperation } from '../helpers/operation-harness'
import type { BinRequirement } from '../../packages/core/src/plugins/bin-requirement'

// A real executable: POSIX sh script. --version exits 0; anything else exits 1.
const GOOD_SCRIPT = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fixture 1.0.0"; exit 0; fi\nexit 1\n'
const BAD_VERIFY_SCRIPT = '#!/bin/sh\nexit 1\n'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// The happy-dom preload replaces global Response with a DOM emulation
// Bun.serve rejects — recover the NATIVE Response class (fake-provider.ts
// precedent) and use Bun's native fetch for real sockets.
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
// The repo's hand-rolled Bun namespace (bun-env.d.ts) doesn't declare serve —
// cast per the fake-provider.ts precedent.
const bunServe = (Bun as unknown as {
  serve: (opts: { port: number; fetch: (req: Request) => Response }) => { port: number; stop: (force?: boolean) => void }
}).serve

let server: { port: number; stop: (force?: boolean) => void }
let hits: Record<string, number> = {}
const fixtures: Record<string, Buffer> = {}

beforeAll(() => {
  server = bunServe({
    port: 0,
    fetch(req: Request) {
      const path = new URL(req.url).pathname
      hits[path] = (hits[path] ?? 0) + 1
      if (fixtures[path]) return new NativeResponse(new Uint8Array(fixtures[path]!))
      if (path === '/good') return new NativeResponse(GOOD_SCRIPT)
      if (path === '/bad-verify') return new NativeResponse(BAD_VERIFY_SCRIPT)
      if (path === '/missing') return new NativeResponse('nope', { status: 404 })
      return new NativeResponse('?', { status: 500 })
    },
  })
})

afterAll(() => {
  server.stop(true)
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  hits = {}
  rmSync(join(testDir, 'bin'), { recursive: true, force: true })
})
afterEach(() => {
  rmSync(join(testDir, 'bin'), { recursive: true, force: true })
})

const key = binPlatformKey()
if (!key) throw new Error('unsupported test platform')

function req(urlPath: string, sha: string, over: Partial<BinRequirement> = {}): BinRequirement {
  return {
    name: 'fixturebin',
    version: '1.0.0',
    install: { [key!]: { url: `http://127.0.0.1:${server.port}${urlPath}`, sha256: sha } },
    verifyArgs: ['--version'],
    ...over,
  }
}

const marker = { package: 'test-pack', version: '1.0.0', ref: 'main', commitSha: 'x'.repeat(40), installedAt: new Date().toISOString() }

describe('binPlatformKey', () => {
  it('maps this platform to a known key', () => {
    expect(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']).toContain(key!)
  })
})

describe('installBinRequirement', () => {
  it('downloads, verifies checksum + run, and commits 0755 with sidecar', async () => {
    const result = await installBinRequirement(req('/good', sha256(GOOD_SCRIPT)), marker, { fetchImpl: nativeFetch })
    expect(result.skipped).toBe(false)
    const target = join(testDir, 'bin', 'fixturebin')
    expect(result.target).toBe(target)
    expect(existsSync(target)).toBe(true)
    expect(statSync(target).mode & 0o777).toBe(0o755)
    expect(readFileSync(target, 'utf-8')).toBe(GOOD_SCRIPT)
    expect(existsSync(`${target}.installedBy`)).toBe(true)
  })

  it('refuses a checksum mismatch and leaves nothing behind', async () => {
    await expect(installBinRequirement(req('/good', sha256('tampered')), marker, { fetchImpl: nativeFetch }))
      .rejects.toThrow(/checksum/i)
    expect(existsSync(join(testDir, 'bin', 'fixturebin'))).toBe(false)
  })

  it('refuses when the verify run fails and leaves nothing behind', async () => {
    await expect(installBinRequirement(req('/bad-verify', sha256(BAD_VERIFY_SCRIPT)), marker, { fetchImpl: nativeFetch }))
      .rejects.toThrow(/verify/i)
    expect(existsSync(join(testDir, 'bin', 'fixturebin'))).toBe(false)
  })

  it('fails honestly on a 404 download', async () => {
    await expect(installBinRequirement(req('/missing', sha256('x')), marker, { fetchImpl: nativeFetch }))
      .rejects.toThrow(/404|download/i)
  })

  it('extracts a tar.gz archive member as the binary (archive sha pins the tarball)', async () => {
    // Build the tarball fixture in-test (same inline-fixture convention as
    // the script constants above — never a machine-specific path).
    const tarSrc = join(testDir, 'tar-src', 'inner')
    mkdirSync(tarSrc, { recursive: true })
    const tarredScript = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "tarred 1.0.0"; exit 0; fi\nexit 1\n'
    writeFileSync(join(tarSrc, 'tarredbin'), tarredScript, { mode: 0o755 })
    const tarPath = join(testDir, 'fixture.tar.gz')
    execSync(`tar -czf ${JSON.stringify(tarPath)} -C ${JSON.stringify(join(testDir, 'tar-src'))} inner/tarredbin`)
    const tarBytes = readFileSync(tarPath)
    const tarSha = createHash('sha256').update(tarBytes).digest('hex')
    fixtures['/tarball'] = tarBytes

    const bin = {
      name: 'tarredbin',
      version: '1.0.0',
      install: { [key!]: { url: `http://127.0.0.1:${server.port}/tarball`, sha256: tarSha, archive: { format: 'tar.gz' as const, member: 'inner/tarredbin', extractedSha256: sha256(tarredScript) } } },
      verifyArgs: ['--version'],
    }
    const result = await installBinRequirement(bin, marker, { fetchImpl: nativeFetch })
    expect(result.skipped).toBe(false)
    expect(readFileSync(result.target, 'utf-8')).toContain('tarred 1.0.0')

    // Fast path: the on-disk bytes match the manifest's extracted pin.
    const again = await installBinRequirement(bin, marker, { fetchImpl: nativeFetch })
    expect(again.skipped).toBe(true)
  })

  it('skips (no re-download) when the installed file already matches the pin', async () => {
    mkdirSync(join(testDir, 'bin'), { recursive: true })
    writeFileSync(join(testDir, 'bin', 'fixturebin'), GOOD_SCRIPT)
    chmodSync(join(testDir, 'bin', 'fixturebin'), 0o755)

    const result = await installBinRequirement(req('/good', sha256(GOOD_SCRIPT)), marker, { fetchImpl: nativeFetch })
    expect(result.skipped).toBe(true)
    expect(hits['/good'] ?? 0).toBe(0)
  })

  it('rejects when the manifest has no download for this platform', async () => {
    const other = key === 'linux-x64' ? 'darwin-arm64' : 'linux-x64'
    const bin: BinRequirement = {
      name: 'fixturebin',
      version: '1.0.0',
      install: { [other]: { url: `http://127.0.0.1:${server.port}/good`, sha256: sha256(GOOD_SCRIPT) } },
    }
    await expect(installBinRequirement(bin, marker, { fetchImpl: nativeFetch }))
      .rejects.toThrow(/platform/i)
  })


  it('a corrupted archive-sourced binary self-heals despite a surviving sidecar', async () => {
    const tarSrc = join(testDir, 'tar-src2', 'inner')
    mkdirSync(tarSrc, { recursive: true })
    const healScript = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "heal 1.0.0"; exit 0; fi\nexit 1\n'
    writeFileSync(join(tarSrc, 'healbin'), healScript, { mode: 0o755 })
    const tarPath = join(testDir, 'heal.tar.gz')
    execSync(`tar -czf ${JSON.stringify(tarPath)} -C ${JSON.stringify(join(testDir, 'tar-src2'))} inner/healbin`)
    const tarBytes = readFileSync(tarPath)
    fixtures['/healtar'] = tarBytes
    const bin = {
      name: 'healbin',
      version: '1.0.0',
      install: { [key!]: { url: `http://127.0.0.1:${server.port}/healtar`, sha256: createHash('sha256').update(tarBytes).digest('hex'), archive: { format: 'tar.gz' as const, member: 'inner/healbin', extractedSha256: sha256(healScript) } } },
      verifyArgs: ['--version'],
    }
    const first = await installBinRequirement(bin, marker, { fetchImpl: nativeFetch })
    expect(first.skipped).toBe(false)

    // Corrupt the on-disk binary; the sidecar (with the pinned tarball sha) survives.
    writeFileSync(first.target, '#!/bin/sh\nexit 7\n', { mode: 0o755 })
    const healed = await installBinRequirement(bin, marker, { fetchImpl: nativeFetch })
    expect(healed.skipped).toBe(false) // re-extracted, not trusted
    expect(readFileSync(healed.target, 'utf-8')).toContain('heal 1.0.0')
  })

  it('a member that does not match its extracted pin never runs and never lands (#898 D)', async () => {
    const ran = join(testDir, 'verify-ran')
    const tarSrc = join(testDir, 'tar-src3', 'inner')
    mkdirSync(tarSrc, { recursive: true })
    // Running it at all would leave a trace — the verify run must not happen.
    writeFileSync(join(tarSrc, 'evilbin'), `#!/bin/sh\ntouch ${JSON.stringify(ran)}\nexit 0\n`, { mode: 0o755 })
    const tarPath = join(testDir, 'evil.tar.gz')
    execSync(`tar -czf ${JSON.stringify(tarPath)} -C ${JSON.stringify(join(testDir, 'tar-src3'))} inner/evilbin`)
    const tarBytes = readFileSync(tarPath)
    fixtures['/eviltar'] = tarBytes
    const bin = {
      name: 'evilbin',
      version: '1.0.0',
      // The archive pin is right (it IS this tarball); the member pin is not.
      install: { [key!]: { url: `http://127.0.0.1:${server.port}/eviltar`, sha256: createHash('sha256').update(tarBytes).digest('hex'), archive: { format: 'tar.gz' as const, member: 'inner/evilbin', extractedSha256: sha256('the reviewed binary') } } },
      verifyArgs: ['--version'],
    }
    await expect(installBinRequirement(bin, marker, { fetchImpl: nativeFetch })).rejects.toThrow(/extractedSha256/)
    expect(existsSync(ran)).toBe(false)
    expect(existsSync(join(testDir, 'bin', 'evilbin'))).toBe(false)
  })

  it('a forged binary under a forged marker is re-downloaded, never skipped', async () => {
    const script = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "real 1.0.0"; exit 0; fi\nexit 1\n'
    const tarSrc = join(testDir, 'tar-src4', 'inner')
    mkdirSync(tarSrc, { recursive: true })
    writeFileSync(join(tarSrc, 'realbin'), script, { mode: 0o755 })
    const tarPath = join(testDir, 'real.tar.gz')
    execSync(`tar -czf ${JSON.stringify(tarPath)} -C ${JSON.stringify(join(testDir, 'tar-src4'))} inner/realbin`)
    const tarBytes = readFileSync(tarPath)
    fixtures['/realtar'] = tarBytes
    const tarSha = createHash('sha256').update(tarBytes).digest('hex')
    const bin = {
      name: 'realbin',
      version: '1.0.0',
      install: { [key!]: { url: `http://127.0.0.1:${server.port}/realtar`, sha256: tarSha, archive: { format: 'tar.gz' as const, member: 'inner/realbin', extractedSha256: sha256(script) } } },
      verifyArgs: ['--version'],
    }
    const target = join(testDir, 'bin', 'realbin')
    mkdirSync(join(testDir, 'bin'), { recursive: true })
    writeFileSync(target, '#!/bin/sh\necho forged\n', { mode: 0o755 })
    // Written raw — the forged extractedSha256 must survive to prove it is ignored.
    writeFileSync(`${target}.installedBy`, JSON.stringify({ ...marker, sha256: tarSha, member: 'inner/realbin', extractedSha256: sha256('#!/bin/sh\necho forged\n') }))
    const result = await installBinRequirement(bin, marker, { fetchImpl: nativeFetch })
    expect(result.skipped).toBe(false)
    expect(readFileSync(target, 'utf-8')).toBe(script)
  })
})

describe('installPluginBins operation reporting (#895)', () => {
  const plan = { stages: [{ id: 'bins', kind: 'installing' as const, label: 'Install binaries' }], pointOfNoReturn: 'bins' }
  const identity = { pluginId: 'fixture-plugin', version: '1.0.0', ref: '', commitSha: '' }
  const run = (bin: BinRequirement) => settleOperation({ plan, resources: ['install-state'] }, async (op) => {
    op.stage('bins')
    return installPluginBins([bin], identity, { op: { op, stageId: 'bins' } })
  })

  it('each binary is an item with its bytes; a re-run at the pin is skipped', async () => {
    const bin = req('/good', sha256(GOOD_SCRIPT))
    const first = await run(bin)
    expect(first.error).toBeUndefined()
    const item = first.view.stages[0]!.items?.[0]
    expect(item).toMatchObject({ id: 'bin:fixturebin', label: 'fixturebin 1.0.0', status: 'done' })
    expect(item?.bytes).toEqual({ received: GOOD_SCRIPT.length, total: GOOD_SCRIPT.length })
    const again = await run(bin)
    expect(again.view.stages[0]!.items?.[0]?.status).toBe('skipped')
  })

  it('a failed binary is a failed item carrying the reason', async () => {
    const { error, view } = await run(req('/good', sha256('tampered')))
    expect(String(error)).toMatch(/checksum/i)
    expect(view.stages[0]!.items?.[0]).toMatchObject({ id: 'bin:fixturebin', status: 'failed' })
    expect(view.stages[0]!.items?.[0]?.message).toMatch(/checksum/i)
  })
})
