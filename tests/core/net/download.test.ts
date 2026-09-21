/**
 * Shared download-verify-commit primitive (#889 T1).
 *
 * Real-HTTP tests over a local Bun.serve fixture (per CLAUDE.md: real
 * sockets need Bun.fetch — the happy-dom fetch replacement breaks them).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-net-download-${Date.now()}-${Math.random().toString(16).slice(2)}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { commitFileAtomic, downloadToFile, extractTarMember, sha256File } from '../../../packages/core/src/net/download'

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')

const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
const bunServe = (Bun as unknown as {
  serve: (opts: { port: number; fetch: (req: Request) => Response | Promise<Response> }) => { port: number; stop: (force?: boolean) => void }
}).serve

const PAYLOAD = 'hello, pinned world\n'
let server: { port: number; stop: (force?: boolean) => void }
let hits: Record<string, number> = {}
const fixtures: Record<string, Buffer> = {}

beforeAll(() => {
  server = bunServe({
    port: 0,
    async fetch(req: Request) {
      const path = new URL(req.url).pathname
      hits[path] = (hits[path] ?? 0) + 1
      if (fixtures[path]) return new NativeResponse(new Uint8Array(fixtures[path]!))
      if (path === '/payload') return new NativeResponse(PAYLOAD)
      if (path === '/missing') return new NativeResponse('nope', { status: 404 })
      if (path === '/slow') {
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        return new NativeResponse(PAYLOAD)
      }
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
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

const url = (path: string) => `http://127.0.0.1:${server.port}${path}`

describe('downloadToFile', () => {
  it('streams to the destination, verifies the pin, and reports sha + bytes', async () => {
    const dest = join(testDir, 'nested', 'payload.txt')
    const result = await downloadToFile(url('/payload'), dest, { sha256: sha256(PAYLOAD), fetchImpl: nativeFetch })
    expect(readFileSync(dest, 'utf-8')).toBe(PAYLOAD)
    expect(result.sha256).toBe(sha256(PAYLOAD))
    expect(result.bytes).toBe(Buffer.byteLength(PAYLOAD))
  })

  it('works without a pin (caller does its own verification)', async () => {
    const dest = join(testDir, 'unpinned.txt')
    const result = await downloadToFile(url('/payload'), dest, { fetchImpl: nativeFetch })
    expect(result.sha256).toBe(sha256(PAYLOAD))
  })

  it('refuses a checksum mismatch and deletes the partial file', async () => {
    const dest = join(testDir, 'tampered.txt')
    await expect(downloadToFile(url('/payload'), dest, { sha256: sha256('other'), fetchImpl: nativeFetch }))
      .rejects.toThrow(/checksum/i)
    expect(existsSync(dest)).toBe(false)
  })

  it('fails honestly on an HTTP error and leaves nothing behind', async () => {
    const dest = join(testDir, 'missing.txt')
    await expect(downloadToFile(url('/missing'), dest, { fetchImpl: nativeFetch }))
      .rejects.toThrow(/404|download/i)
    expect(existsSync(dest)).toBe(false)
  })

  it('labels errors with the caller-supplied prefix', async () => {
    await expect(downloadToFile(url('/missing'), join(testDir, 'x'), { label: 'Binary "ripgrep"', fetchImpl: nativeFetch }))
      .rejects.toThrow(/Binary "ripgrep"/)
  })

  it('wires the timeout signal into the fetch and leaves nothing behind on abort', async () => {
    // The happy-dom preload replaces global AbortSignal with an emulation
    // Bun's native fetch does not honor, so the timeout cannot be observed
    // through a real socket here (production runs without happy-dom). An
    // observing fetchImpl verifies the signal is wired and fires instead.
    const dest = join(testDir, 'slow.txt')
    const abortingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) {
          reject(new Error('no signal wired'))
          return
        }
        signal.addEventListener('abort', () => reject(new Error('The operation timed out')))
      })) as unknown as typeof fetch
    await expect(downloadToFile(url('/slow'), dest, { timeoutMs: 50, fetchImpl: abortingFetch }))
      .rejects.toThrow(/timed out/)
    expect(existsSync(dest)).toBe(false)
  })
})

describe('sha256File', () => {
  it('hashes file contents streamed from disk', async () => {
    const p = join(testDir, 'hashme.bin')
    writeFileSync(p, PAYLOAD)
    expect(await sha256File(p)).toBe(sha256(PAYLOAD))
  })
})

describe('extractTarMember', () => {
  it('extracts the named member and returns its path', async () => {
    const src = join(testDir, 'tar-src', 'inner')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'member.txt'), 'tarred contents\n')
    const tarPath = join(testDir, 'fixture.tar.gz')
    execSync(`tar -czf ${JSON.stringify(tarPath)} -C ${JSON.stringify(join(testDir, 'tar-src'))} inner/member.txt`)

    const outDir = join(testDir, 'extract-out')
    mkdirSync(outDir, { recursive: true })
    const memberPath = await extractTarMember(tarPath, 'inner/member.txt', outDir)
    expect(memberPath).toBe(join(outDir, 'inner/member.txt'))
    expect(readFileSync(memberPath, 'utf-8')).toBe('tarred contents\n')
  })

  it('throws when the member is not in the archive', async () => {
    const src = join(testDir, 'tar-src2')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'present.txt'), 'x')
    const tarPath = join(testDir, 'fixture2.tar.gz')
    execSync(`tar -czf ${JSON.stringify(tarPath)} -C ${JSON.stringify(src)} present.txt`)

    const outDir = join(testDir, 'extract-out2')
    mkdirSync(outDir, { recursive: true })
    await expect(extractTarMember(tarPath, 'absent.txt', outDir)).rejects.toThrow(/extract|not found/i)
  })
})

describe('commitFileAtomic', () => {
  it('renames into place with the requested mode', async () => {
    const tmp = join(testDir, 'stage.tmp')
    writeFileSync(tmp, '#!/bin/sh\nexit 0\n')
    const target = join(testDir, 'out', 'committed')
    await commitFileAtomic(tmp, target, { mode: 0o755 })
    expect(existsSync(tmp)).toBe(false)
    expect(statSync(target).mode & 0o777).toBe(0o755)
  })

  it('runs the verify hook against the temp file BEFORE the rename', async () => {
    const tmp = join(testDir, 'stage2.tmp')
    writeFileSync(tmp, 'content')
    const target = join(testDir, 'out2', 'committed')
    const seen: string[] = []
    await commitFileAtomic(tmp, target, {
      verify: async (path) => {
        seen.push(path)
        expect(existsSync(target)).toBe(false) // not yet committed
      },
    })
    expect(seen).toEqual([tmp])
    expect(existsSync(target)).toBe(true)
  })

  it('a failed verify leaves no target and cleans the temp file', async () => {
    const tmp = join(testDir, 'stage3.tmp')
    writeFileSync(tmp, 'broken')
    const target = join(testDir, 'out3', 'committed')
    await expect(commitFileAtomic(tmp, target, {
      verify: async () => { throw new Error('verify run failed: fixture says no') },
    })).rejects.toThrow(/verify/i)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(tmp)).toBe(false)
  })

  it('never clobbers an existing target when verify fails', async () => {
    const target = join(testDir, 'out4', 'committed')
    mkdirSync(join(testDir, 'out4'), { recursive: true })
    writeFileSync(target, 'working install')
    const tmp = join(testDir, 'stage4.tmp')
    writeFileSync(tmp, 'broken update')
    await expect(commitFileAtomic(tmp, target, {
      verify: async () => { throw new Error('verify run failed') },
    })).rejects.toThrow(/verify/i)
    expect(readFileSync(target, 'utf-8')).toBe('working install')
  })
})
