/**
 * Login verification engine (spec provider-integrations §4.1, plan 1.3).
 * Fake probes are shell scripts; the "bin" route pins their sha256 like a
 * managed binary, the "prereq" route finds them on PATH.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-login-verify-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
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

import {
  currentLoginInputs,
  isReceiptStale,
  loginReceiptPath,
  readLoginReceipt,
  verifyLogin,
  type LoginReceipt,
} from '../../src/core/agent-packages/login-verify'
import { binPlatformKey } from '../../src/core/agent-packages/bin-installer'
import type { SkillPackManifest } from '../../packages/core/src/agent-packages/manifest'

const binDir = join(testDir, 'bin')
const pathDir = join(testDir, 'onpath')
const originalPath = process.env.PATH

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** A fake probe at <dir>/<name>; returns its sha256 so the bin route can pin it. */
function script(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const text = `#!/bin/sh\n${body}\n`
  writeFileSync(join(dir, name), text)
  chmodSync(join(dir, name), 0o755)
  return sha256(text)
}

function binManifest(name: string, sha: string, extra: Partial<SkillPackManifest> = {}, login: Record<string, unknown> = {}): SkillPackManifest {
  const platform = binPlatformKey()!
  return {
    id: 'gw',
    kind: 'skill-pack',
    name: 'Google Workspace',
    version: '2.0.0',
    capability: 'google-workspace',
    runtimes: ['*'],
    contributions: { skills: [] },
    requires: {
      bins: [{ name, version: '1.0.0', install: { [platform]: { url: `https://example.test/${name}`, sha256: sha } } }],
      login: [{ name: 'Google account', probe: [name, 'auth', 'list'], setup: 'gog auth setup', help: 'https://gogcli.sh', ...login }],
    },
    ...extra,
  } as SkillPackManifest
}

function prereqManifest(name: string): SkillPackManifest {
  return {
    id: 'gh-pack',
    kind: 'skill-pack',
    name: 'GitHub',
    version: '1.1.0',
    capability: 'github',
    runtimes: ['*'],
    contributions: { skills: [] },
    requires: {
      prereqs: [{ name: 'GitHub CLI', kind: 'binary', probe: name, help: 'https://cli.github.com/', optional: false }],
      login: [{ name: 'GitHub account', probe: [name, 'auth', 'status'], setup: 'gh auth login', help: 'https://cli.github.com/' }],
    },
  } as SkillPackManifest
}

beforeAll(() => {
  mkdirSync(binDir, { recursive: true })
  mkdirSync(pathDir, { recursive: true })
})
beforeEach(() => {
  process.env.PATH = `${pathDir}:${originalPath}`
  delete process.env.MY_ACCOUNT
  rmSync(join(testDir, 'packages'), { recursive: true, force: true })
})
afterAll(() => {
  process.env.PATH = originalPath
  rmSync(testDir, { recursive: true, force: true })
})

describe('verifyLogin — bin route', () => {
  it('exit 0 is ok and writes a receipt carrying the verified binary sha', async () => {
    const sha = script(binDir, 'okprobe', 'echo "me@example.com"; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('okprobe', sha) })
    expect(receipt.status).toBe('ok')
    expect(receipt.binarySha256).toBe(sha)
    expect(receipt.exitCode).toBe(0)
    expect(receipt.account).toBe('me@example.com')
    expect(existsSync(loginReceiptPath('gw'))).toBe(true)
    expect(readLoginReceipt('gw')).toEqual(receipt)
  })

  it('non-zero exit is missing with reason exit', async () => {
    const sha = script(binDir, 'noprobe', 'echo "no accounts" >&2; exit 1')
    const receipt = await verifyLogin({ manifest: binManifest('noprobe', sha) })
    expect(receipt.status).toBe('missing')
    expect(receipt.reason).toBe('exit')
    expect(receipt.exitCode).toBe(1)
  })

  it('a probe that hangs is killed at the timeout and reads unknown', async () => {
    const sha = script(binDir, 'hangprobe', 'sleep 30')
    const started = Date.now()
    const receipt = await verifyLogin({ manifest: binManifest('hangprobe', sha), timeoutMs: 200 })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(receipt.status).toBe('unknown')
    expect(receipt.reason).toBe('timeout')
  })

  it('a declared bin that is missing or drifted never executes — unknown with the binary reason', async () => {
    const missing = await verifyLogin({ manifest: binManifest('absentprobe', 'a'.repeat(64)) })
    expect(missing.status).toBe('unknown')
    expect(missing.reason).toBe('binary-missing')

    script(binDir, 'driftprobe', 'echo should-not-run; exit 0')
    const drifted = await verifyLogin({ manifest: binManifest('driftprobe', 'b'.repeat(64)) })
    expect(drifted.status).toBe('unknown')
    expect(drifted.reason).toBe('binary-unverifiable')
    expect(drifted.output).toBe('')
  })

  it('bounds the persisted output', async () => {
    const sha = script(binDir, 'loudprobe', 'head -c 200000 /dev/zero | tr "\\0" "x"; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('loudprobe', sha) })
    expect(receipt.status).toBe('ok')
    expect(receipt.output.length).toBeLessThanOrEqual(16 * 1024)
  })

  it('runs one probe for concurrent requests (in-flight dedupe)', async () => {
    const counter = join(testDir, 'count.txt')
    const sha = script(binDir, 'countprobe', `echo x >> "${counter}"; sleep 0.2; exit 0`)
    const manifest = binManifest('countprobe', sha)
    const [a, b] = await Promise.all([verifyLogin({ manifest }), verifyLogin({ manifest })])
    expect(a.status).toBe('ok')
    expect(b.checkedAt).toBe(a.checkedAt)
    expect(readFileSync(counter, 'utf-8').trim().split('\n')).toHaveLength(1)
  })
})

describe('verifyLogin — account verification', () => {
  it('ok only when the configured account appears in the output; otherwise missing with account-mismatch', async () => {
    process.env.MY_ACCOUNT = 'mark@org.example'
    const good = script(binDir, 'acctprobe', 'echo "mark@org.example (default)"; exit 0')
    const ok = await verifyLogin({ manifest: binManifest('acctprobe', good, {}, { accountEnv: 'MY_ACCOUNT' }) })
    expect(ok.status).toBe('ok')
    expect(ok.account).toBe('mark@org.example')

    const other = script(binDir, 'acctprobe2', 'echo "someone@else.example"; exit 0')
    const bad = await verifyLogin({ manifest: binManifest('acctprobe2', other, {}, { accountEnv: 'MY_ACCOUNT' }) })
    expect(bad.status).toBe('missing')
    expect(bad.reason).toBe('account-mismatch')
  })

  it('an unset accountEnv is not a constraint', async () => {
    const sha = script(binDir, 'anyprobe', 'echo "whoever"; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('anyprobe', sha, {}, { accountEnv: 'MY_ACCOUNT' }) })
    expect(receipt.status).toBe('ok')
  })
})

describe('verifyLogin — prereq route', () => {
  it('resolves a binary prereq on PATH; absent is unknown with binary-missing', async () => {
    script(pathDir, 'ghlike', 'echo "Logged in to github.com account markhayden"; exit 0')
    const ok = await verifyLogin({ manifest: prereqManifest('ghlike') })
    expect(ok.status).toBe('ok')
    expect(ok.binaryPath).toBe(join(pathDir, 'ghlike'))

    const gone = await verifyLogin({ manifest: prereqManifest('notonpath') })
    expect(gone.status).toBe('unknown')
    expect(gone.reason).toBe('binary-missing')
  })
})

describe('receipt staleness', () => {
  it('is stale when the pack version, binary sha, account input or declared secrets changed', async () => {
    const sha = script(binDir, 'staleprobe', 'exit 0')
    const manifest = binManifest('staleprobe', sha, { secrets: [{ name: 'GW_TOKEN', description: 'x', required: false, secretSlot: 'skills.gw.GW_TOKEN' }] }, { accountEnv: 'MY_ACCOUNT' })
    const receipt = await verifyLogin({ manifest })
    const current = currentLoginInputs(manifest)
    expect(isReceiptStale(receipt, current)).toBe(false)
    expect(isReceiptStale(receipt, { ...current, packVersion: '2.0.1' })).toBe(true)
    expect(isReceiptStale(receipt, { ...current, binarySha256: 'c'.repeat(64) })).toBe(true)
    process.env.MY_ACCOUNT = 'changed@example'
    expect(isReceiptStale(receipt, currentLoginInputs(manifest))).toBe(true)
    delete process.env.MY_ACCOUNT
    process.env.GW_TOKEN = 'new-secret'
    expect(isReceiptStale(receipt, currentLoginInputs(manifest))).toBe(true)
    delete process.env.GW_TOKEN
    expect(isReceiptStale(receipt, currentLoginInputs(manifest))).toBe(false)
  })

  it('readLoginReceipt is null when nothing was ever checked', () => {
    expect(readLoginReceipt('never-checked')).toBeNull()
  })

  it('a receipt that is not JSON reads as null, never as a status', () => {
    const path = loginReceiptPath('garbage')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '{not json')
    expect(readLoginReceipt('garbage')).toBeNull()
    const typed: LoginReceipt | null = readLoginReceipt('garbage')
    expect(typed).toBeNull()
  })
})
