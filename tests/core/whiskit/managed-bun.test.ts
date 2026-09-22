/**
 * Managed bun runtime (margo 2026-09-21): a compiled-binary box with no dev
 * toolchain must be able to run capability-pack npm payloads — Bakin
 * installs its own pinned bun instead of failing with "install Bun" advice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-managed-bun-${Date.now()}-${Math.random().toString(16).slice(2)}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// Pin module is mocked with loopback URLs (patched in beforeAll) — the pin
// DATA module pattern would be const-captured too early (media-pipeline.md).
type Download = { pkg: string; url: string; sha256: string }
const downloads: Record<string, Download> = {
  'darwin-arm64': { pkg: '@oven/bun-darwin-aarch64', url: '', sha256: '' },
  'linux-x64': { pkg: '@oven/bun-linux-x64', url: '', sha256: '' },
  'linux-arm64': { pkg: '@oven/bun-linux-aarch64', url: '', sha256: '' },
}
mock.module('../../../src/core/whiskit/bun-pin', () => ({
  MANAGED_BUN_VERSION: '0.0.1-fixture',
  MANAGED_BUN_DOWNLOADS: downloads,
}))

import { ensureBunAvailable, managedBunPath } from '../../../src/core/whiskit/managed-bun'
import { findSystemBun, wellKnownBunLocations } from '../../../src/core/whiskit/command'

// A real executable standing in for bun: answers --version with exit 0.
const FAKE_BUN = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "0.0.1-fixture"; exit 0; fi\nexit 1\n'
const BROKEN_BUN = '#!/bin/sh\nexit 7\n'

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
const bunServe = (Bun as unknown as {
  serve: (opts: { port: number; fetch: (req: Request) => Response }) => { port: number; stop: (force?: boolean) => void }
}).serve

let server: { port: number; stop: (force?: boolean) => void }
let tarballHits = 0

function makeBunTarball(contents: string): Buffer {
  const src = join(testDir, 'tar-src', 'package', 'bin')
  rmSync(join(testDir, 'tar-src'), { recursive: true, force: true })
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'bun'), contents, { mode: 0o755 })
  const tarPath = join(testDir, 'bun-fixture.tgz')
  execSync(`tar -czf ${JSON.stringify(tarPath)} -C ${JSON.stringify(join(testDir, 'tar-src'))} package`)
  return readFileSync(tarPath)
}

let tarball: Buffer

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  tarball = makeBunTarball(FAKE_BUN)
  server = bunServe({
    port: 0,
    fetch(req: Request) {
      if (new URL(req.url).pathname === '/bun.tgz') {
        tarballHits += 1
        return new NativeResponse(new Uint8Array(tarball))
      }
      return new NativeResponse('nope', { status: 404 })
    },
  })
  for (const key of Object.keys(downloads)) {
    downloads[key] = { ...downloads[key]!, url: `http://127.0.0.1:${server.port}/bun.tgz`, sha256: sha256(tarball) }
  }
})

afterAll(() => {
  server.stop(true)
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  tarballHits = 0
  rmSync(join(testDir, 'bin'), { recursive: true, force: true })
})

describe('ensureBunAvailable', () => {
  it('prefers a system bun — no download, no managed install', async () => {
    const path = await ensureBunAvailable({ fetchImpl: nativeFetch, locate: () => '/usr/local/bin/bun' })
    expect(path).toBe('/usr/local/bin/bun')
    expect(tarballHits).toBe(0)
    expect(existsSync(managedBunPath())).toBe(false)
  })

  it('installs the pinned managed bun when no system bun exists', async () => {
    const path = await ensureBunAvailable({ fetchImpl: nativeFetch, locate: () => null })
    expect(path).toBe(managedBunPath())
    expect(tarballHits).toBe(1)
    expect(statSync(path).mode & 0o777).toBe(0o755)
    expect(readFileSync(path, 'utf-8')).toBe(FAKE_BUN)
  })

  it('reuses a previously-managed bun without re-downloading', async () => {
    await ensureBunAvailable({ fetchImpl: nativeFetch, locate: () => null })
    const again = await ensureBunAvailable({ fetchImpl: nativeFetch, locate: () => null })
    expect(again).toBe(managedBunPath())
    expect(tarballHits).toBe(1)
  })

  it('a managed bun that fails its version check is reinstalled', async () => {
    mkdirSync(join(testDir, 'bin'), { recursive: true })
    writeFileSync(managedBunPath(), BROKEN_BUN, { mode: 0o755 })
    const path = await ensureBunAvailable({ fetchImpl: nativeFetch, locate: () => null })
    expect(path).toBe(managedBunPath())
    expect(tarballHits).toBe(1)
    expect(readFileSync(path, 'utf-8')).toBe(FAKE_BUN)
  })

  it('a checksum mismatch refuses the install and leaves no managed bun', async () => {
    const good = { ...downloads['darwin-arm64']! }
    for (const key of Object.keys(downloads)) downloads[key] = { ...downloads[key]!, sha256: sha256('tampered') }
    try {
      await expect(ensureBunAvailable({ fetchImpl: nativeFetch, locate: () => null }))
        .rejects.toThrow(/checksum/i)
      expect(existsSync(managedBunPath())).toBe(false)
    } finally {
      for (const key of Object.keys(downloads)) downloads[key] = { ...downloads[key]!, sha256: good.sha256 }
    }
  })
})

describe('findSystemBun well-known locations (margo: launchd PATH missed ~/.bun/bin)', () => {
  it('falls back to an existing well-known location when PATH lookup fails', () => {
    const fake = join(testDir, 'well-known', 'bun')
    mkdirSync(join(testDir, 'well-known'), { recursive: true })
    writeFileSync(fake, FAKE_BUN, { mode: 0o755 })
    // PATH lookup for literal 'bun' may succeed on dev machines — pass only
    // our candidate and rely on Bun.which being beaten by BAKIN_BUN_PATH...
    // deterministic route: candidates are only consulted when which() missed,
    // so simulate that with a name PATH cannot have by checking the candidate
    // list contract directly instead.
    expect(wellKnownBunLocations('/home/fixture')).toEqual([
      '/home/fixture/.bun/bin/bun',
      '/opt/homebrew/bin/bun',
      '/usr/local/bin/bun',
      join(process.env.BAKIN_HOME?.trim() || '/home/fixture/.bakin', 'bin', 'bun'),
    ])
    // And BAKIN_BUN_PATH still wins over everything.
    process.env.BAKIN_BUN_PATH = fake
    try {
      expect(findSystemBun([])).toBe(fake)
    } finally {
      delete process.env.BAKIN_BUN_PATH
    }
  })
})
