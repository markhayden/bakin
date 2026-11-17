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
  listInstalledLoginPacks,
  loginReceiptPath,
  readLoginReceipt,
  verifyInstalledPackLogins,
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
    contributions: { skills: ['skills/x'] },
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
    contributions: { skills: ['skills/x'] },
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
    expect(receipt.binaryIdentity).toBe(`sha256:${sha}`)
    expect(receipt.binaryPath).toBe(join(binDir, 'okprobe'))
    expect(receipt.exitCode).toBe(0)
    expect(receipt.account).toBe('me@example.com')
    expect(existsSync(loginReceiptPath('gw', 'Google account'))).toBe(true)
    expect(readLoginReceipt('gw', 'Google account')).toEqual(receipt)
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

describe('verifyLogin — expected output (tools whose auth listing exits 0 when logged out)', () => {
  const EXPECT = '"email":\\s*"([^"]+)"[^}]*"valid":\\s*true'

  it('exit 0 without a match is missing/no-match; the setup command is the fix', async () => {
    const sha = script(binDir, 'emptyprobe', 'echo \'{"accounts": []}\'; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('emptyprobe', sha, {}, { expect: EXPECT }) })
    expect(receipt.status).toBe('missing')
    expect(receipt.reason).toBe('no-match')
    expect(receipt.exitCode).toBe(0)
    expect(receipt.account).toBeUndefined()
    expect(receipt.expect).toBe(EXPECT)
  })

  it('a match is ok and the first capturing group is the account — never the first stdout line', async () => {
    const sha = script(binDir, 'validprobe', 'printf \'{\\n  "accounts": [\\n    {\\n      "email": "mark@example.com",\\n      "valid": true\\n    }\\n  ]\\n}\\n\'; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('validprobe', sha, {}, { expect: EXPECT }) })
    expect(receipt.status).toBe('ok')
    expect(receipt.account).toBe('mark@example.com')
  })

  it('a pattern without a capturing group yields ok with no account (not a brace)', async () => {
    const sha = script(binDir, 'nogroupprobe', 'echo \'{"accounts":[{"email":"x@y","valid":true}]}\'; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('nogroupprobe', sha, {}, { expect: '"valid":\\s*true' }) })
    expect(receipt.status).toBe('ok')
    expect(receipt.account).toBeUndefined()
  })

  it('expect and accountEnv compose: a valid token for another account is account-mismatch', async () => {
    process.env.MY_ACCOUNT = 'mark@example.com'
    try {
      const sha = script(binDir, 'otherprobe', 'echo \'{"accounts":[{"email":"else@example.com","valid":true}]}\'; exit 0')
      const receipt = await verifyLogin({ manifest: binManifest('otherprobe', sha, {}, { expect: EXPECT, accountEnv: 'MY_ACCOUNT' }) })
      expect(receipt.status).toBe('missing')
      expect(receipt.reason).toBe('account-mismatch')
    } finally {
      delete process.env.MY_ACCOUNT
    }
  })

  it('with accountEnv, the configured account must BE a valid capture — a valid second account never vouches for a revoked first (Codex r4 B2)', async () => {
    process.env.MY_ACCOUNT = 'old@example.com'
    try {
      const mixed = 'echo \'{"accounts":[{"email":"old@example.com","auth":"oauth","valid":false,"error":"revoked"},{"email":"new@example.com","auth":"oauth","valid":true}]}\'; exit 0'
      const sha = script(binDir, 'mixedprobe', mixed)
      const receipt = await verifyLogin({ manifest: binManifest('mixedprobe', sha, {}, { expect: EXPECT, accountEnv: 'MY_ACCOUNT' }) })
      expect(receipt.status).toBe('missing')
      expect(receipt.reason).toBe('account-mismatch')
      expect(receipt.account).toBeUndefined()

      // The configured account valid in SECOND place is a login — every match counts, not only the first.
      const second = 'echo \'{"accounts":[{"email":"new@example.com","valid":true},{"email":"old@example.com","valid":true}]}\'; exit 0'
      const sha2 = script(binDir, 'secondprobe', second)
      const ok = await verifyLogin({ manifest: binManifest('secondprobe', sha2, {}, { expect: EXPECT, accountEnv: 'MY_ACCOUNT' }) })
      expect(ok.status).toBe('ok')
      expect(ok.account).toBe('old@example.com')
    } finally {
      delete process.env.MY_ACCOUNT
    }
  })

  it('the configured account past the 256th distinct capture is still a login (Codex r6 B5: membership is not the display list)', async () => {
    process.env.MY_ACCOUNT = 'u256@example.com'
    try {
      const listing = JSON.stringify({ accounts: Array.from({ length: 257 }, (_, i) => ({ email: `u${i}@example.com`, valid: true })) })
      const sha = script(binDir, 'manyprobe', `cat <<'JSON'\n${listing}\nJSON\nexit 0`)
      const receipt = await verifyLogin({ manifest: binManifest('manyprobe', sha, {}, { expect: EXPECT, accountEnv: 'MY_ACCOUNT' }) })
      expect(receipt.status).toBe('ok')
      expect(receipt.account).toBe('u256@example.com')
    } finally {
      delete process.env.MY_ACCOUNT
    }
  })

  it('without accountEnv the account shown is the first valid capture', async () => {
    const sha = script(binDir, 'firstvalidprobe', 'echo \'{"accounts":[{"email":"old@example.com","valid":false},{"email":"new@example.com","valid":true}]}\'; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('firstvalidprobe', sha, {}, { expect: EXPECT }) })
    expect(receipt.status).toBe('ok')
    expect(receipt.account).toBe('new@example.com')
  })

  it('a catastrophic pattern is unknown/expect-timeout at the deadline and never stalls the server loop (Codex r4 B1)', async () => {
    const sha = script(binDir, 'redosprobe', `printf '%s' "$(printf 'a%.0s' $(seq 1 10000))"; exit 0`)
    let ticks = 0
    const interval = setInterval(() => { ticks += 1 }, 25)
    try {
      const receipt = await verifyLogin({ manifest: binManifest('redosprobe', sha, {}, { expect: 'a*a*a*a*a*a*a*a*b' }), timeoutMs: 800 })
      expect(receipt.status).toBe('unknown')
      expect(receipt.reason).toBe('expect-timeout')
      expect(receipt.exitCode).toBe(0)
      expect(ticks).toBeGreaterThanOrEqual(10)
    } finally {
      clearInterval(interval)
    }
  })

  it('a changed expect pattern makes the receipt stale', async () => {
    const sha = script(binDir, 'staleprobe', 'echo \'{"accounts":[{"email":"x@y","valid":true}]}\'; exit 0')
    const manifest = binManifest('staleprobe', sha, {}, { expect: EXPECT })
    const receipt = await verifyLogin({ manifest })
    expect(isReceiptStale(receipt, currentLoginInputs(manifest), receipt.probe)).toBe(false)
    const edited = binManifest('staleprobe', sha, {}, { expect: '"valid":\\s*true' })
    expect(isReceiptStale(receipt, currentLoginInputs(edited), receipt.probe)).toBe(true)
    // An undeclared expect reads null on both sides (older receipts carry none).
    const plain = binManifest('staleprobe', sha)
    const { expect: _dropped, ...legacy } = await verifyLogin({ manifest: plain })
    expect(isReceiptStale(legacy as typeof receipt, currentLoginInputs(plain), receipt.probe)).toBe(false)
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
    expect(isReceiptStale(receipt, { ...current, binaryIdentity: `sha256:${'c'.repeat(64)}` })).toBe(true)
    expect(isReceiptStale(receipt, current, ['staleprobe', 'auth', 'status'])).toBe(true) // the probe itself changed
    process.env.MY_ACCOUNT = 'changed@example'
    expect(isReceiptStale(receipt, currentLoginInputs(manifest))).toBe(true)
    delete process.env.MY_ACCOUNT
    process.env.GW_TOKEN = 'new-secret'
    expect(isReceiptStale(receipt, currentLoginInputs(manifest))).toBe(true)
    delete process.env.GW_TOKEN
    expect(isReceiptStale(receipt, currentLoginInputs(manifest))).toBe(false)
  })

  it('readLoginReceipt is null when nothing was ever checked', () => {
    expect(readLoginReceipt('never-checked', 'x')).toBeNull()
  })

  it('a receipt that is not JSON reads as null, never as a status', () => {
    const path = loginReceiptPath('garbage', 'Some Login')
    expect(path.endsWith(join('garbage', 'some-login.json'))).toBe(true)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '{not json')
    expect(readLoginReceipt('garbage', 'Some Login')).toBeNull()
    const typed: LoginReceipt | null = readLoginReceipt('garbage', 'Some Login')
    expect(typed).toBeNull()
  })

  it('a replaced PATH binary makes the receipt stale (size/mtime identity)', async () => {
    script(pathDir, 'swapprobe', 'exit 0')
    const manifest = prereqManifest('swapprobe')
    const receipt = await verifyLogin({ manifest })
    expect(receipt.binaryIdentity).toMatch(/^stat:\d+:\d+$/)
    expect(isReceiptStale(receipt, currentLoginInputs(manifest))).toBe(false)
    script(pathDir, 'swapprobe', 'echo replaced-with-a-longer-body; exit 0')
    expect(isReceiptStale(receipt, currentLoginInputs(manifest))).toBe(true)
  })
})

describe('verifyLogin — a binary the lookup cannot even try (Codex r8 B7)', () => {
  it('a 1 KB probe name is unknown/binary-missing, never a throw out of the verifier', async () => {
    const receipt = await verifyLogin({ manifest: prereqManifest('x'.repeat(1024)) })
    expect(receipt.status).toBe('unknown')
    expect(receipt.reason).toBe('binary-missing')
    expect(receipt.binaryPath).toBeNull()
  })
})

describe('installed packs — list and filtered re-check', () => {
  function seedInstalled(id: string, version: string, manifest: Record<string, unknown>, lock: Record<string, unknown>): void {
    const dir = join(testDir, 'packages', 'skill-packs', `${id}@${version}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify(manifest))
    lock[`${id}@${version}`] = { kind: 'skill-pack', version, source: `github:x/y#packs/${id}`, ref: 'main', commitSha: 'c'.repeat(40), installedAt: new Date().toISOString(), projections: [] }
  }
  function writeLock(lock: Record<string, unknown>): void {
    mkdirSync(join(testDir, 'packages'), { recursive: true })
    writeFileSync(join(testDir, 'packages', 'lock.json'), JSON.stringify({ version: 1, packages: lock }))
  }
  function loginPack(id: string, probe: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id, kind: 'skill-pack', name: id, version: '1.0.0', capability: id, contributions: { skills: ['skills/x'] },
      requires: {
        prereqs: [{ name: `${probe} cli`, kind: 'binary', probe, help: 'https://x.dev' }],
        login: [{ name: `${id} account`, probe: [probe, 'status'], setup: `${probe} login`, help: 'https://x.dev' }],
      },
      ...extra,
    }
  }

  it('lists only installed skill-packs that declare login, once per identity', () => {
    const lock: Record<string, unknown> = {}
    seedInstalled('alpha', '1.0.0', loginPack('alpha', 'alphaprobe'), lock)
    seedInstalled('plain', '1.0.0', { id: 'plain', kind: 'skill-pack', name: 'plain', version: '1.0.0', capability: 'plain', contributions: { skills: ['skills/x'] } }, lock)
    lock['alpha@0.9.0'] = { ...(lock['alpha@1.0.0'] as object), version: '1.0.0' } // stale key, same identity
    writeLock(lock)
    expect(listInstalledLoginPacks().map((p) => p.key)).toEqual(['alpha@1.0.0'])
  })

  it('re-checks by id or key, by declared secret slot, and skips fresh receipts when asked', async () => {
    script(pathDir, 'alphaprobe', 'exit 0')
    script(pathDir, 'betaprobe', 'exit 1')
    const lock: Record<string, unknown> = {}
    seedInstalled('alpha', '1.0.0', loginPack('alpha', 'alphaprobe', { secrets: [{ name: 'ALPHA_TOKEN', description: 'x', required: false, secretSlot: 'skills.alpha.ALPHA_TOKEN' }] }), lock)
    seedInstalled('beta', '1.0.0', loginPack('beta', 'betaprobe'), lock)
    writeLock(lock)

    const byId = await verifyInstalledPackLogins({ packId: 'alpha' })
    expect(byId.map((r) => [r.packId, r.receipt.status])).toEqual([['alpha', 'ok']])
    const byKey = await verifyInstalledPackLogins({ packId: 'beta@1.0.0' })
    expect(byKey.map((r) => [r.packId, r.receipt.status])).toEqual([['beta', 'missing']])
    const bySlot = await verifyInstalledPackLogins({ secretSlot: 'skills.alpha.ALPHA_TOKEN' })
    expect(bySlot.map((r) => r.packId)).toEqual(['alpha'])
    expect(await verifyInstalledPackLogins({ secretSlot: 'skills.nobody.X' })).toEqual([])

    // A pack whose binary cannot even be looked up, seeded FIRST, never costs the healthy pack its check (Codex r8 B7).
    const poisoned: Record<string, unknown> = {}
    seedInstalled('aaa-broken', '1.0.0', loginPack('aaa-broken', 'x'.repeat(1024)), poisoned)
    seedInstalled('alpha', '1.0.0', loginPack('alpha', 'alphaprobe'), poisoned)
    writeLock(poisoned)
    const contained = await verifyInstalledPackLogins()
    expect(contained.map((r) => [r.packId, r.receipt.status])).toContainEqual(['alpha', 'ok'])
    writeLock(lock)

    // Fresh receipts exist for both now: onlyIfStale re-checks neither.
    expect(await verifyInstalledPackLogins({ onlyIfStale: true })).toEqual([])
    rmSync(loginReceiptPath('beta', 'beta account'), { force: true })
    expect((await verifyInstalledPackLogins({ onlyIfStale: true })).map((r) => r.packId)).toEqual(['beta'])
  })
})

describe('verifyLogin — review hardening (Codex PR1 r1)', () => {
  it('two login entries on one pack never share a verdict', async () => {
    const okSha = script(binDir, 'twoprobe', 'exit 0')
    const platform = binPlatformKey()!
    const manifest = {
      id: 'two', kind: 'skill-pack', name: 'two', version: '1.0.0', capability: 'two', runtimes: ['*'], contributions: { skills: ['skills/x'] },
      requires: {
        bins: [{ name: 'twoprobe', version: '1.0.0', install: { [platform]: { url: 'https://example.test/two', sha256: okSha } } }],
        login: [
          { name: 'First account', probe: ['twoprobe', 'first'], setup: 'first login', help: 'https://x.dev', accountEnv: 'TWO_FIRST' },
          { name: 'Second account', probe: ['twoprobe', 'second'], setup: 'second login', help: 'https://x.dev' },
        ],
      },
    } as unknown as SkillPackManifest
    process.env.TWO_FIRST = 'nobody-prints-this'
    try {
      const first = await verifyLogin({ manifest, entry: manifest.requires!.login![0] })
      const second = await verifyLogin({ manifest, entry: manifest.requires!.login![1] })
      expect(first.status).toBe('missing')
      expect(second.status).toBe('ok')
      expect(readLoginReceipt('two', 'First account')?.status).toBe('missing')
      expect(readLoginReceipt('two', 'Second account')?.status).toBe('ok')
    } finally {
      delete process.env.TWO_FIRST
    }
  })

  it('the account must appear on STDOUT — a stderr diagnostic naming it is not a login', async () => {
    process.env.MY_ACCOUNT = 'mark@org.example'
    const sha = script(binDir, 'stderrprobe', 'echo "someone@else.example"; echo "hint: mark@org.example" >&2; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('stderrprobe', sha, {}, { accountEnv: 'MY_ACCOUNT' }) })
    expect(receipt.status).toBe('missing')
    expect(receipt.reason).toBe('account-mismatch')
  })

  it('a probe ended by a signal we did not send is unknown (killed), not missing', async () => {
    const sha = script(binDir, 'sigprobe', 'kill -TERM $$')
    const receipt = await verifyLogin({ manifest: binManifest('sigprobe', sha) })
    expect(receipt.status).toBe('unknown')
    expect(receipt.reason).toBe('killed')
  })

  it('one 16 KB byte budget covers both streams, multibyte included', async () => {
    const sha = script(binDir, 'utfprobe', 'yes "€" | head -c 24000 | tr -d "\\n"; yes "€" | head -c 24000 | tr -d "\\n" >&2; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('utfprobe', sha) })
    expect(receipt.status).toBe('ok')
    expect(Buffer.byteLength(receipt.output, 'utf-8')).toBeLessThanOrEqual(16 * 1024)
  })

  it('the persisted output never exceeds the cap by a torn multibyte character', async () => {
    // 6,000 × '€' = 18,000 bytes; the budget cuts mid-character at 16,384.
    const sha = script(binDir, 'tornprobe', 'yes "€" | head -c 18000 | tr -d "\\n"; exit 0')
    const receipt = await verifyLogin({ manifest: binManifest('tornprobe', sha) })
    expect(receipt.status).toBe('ok')
    expect(Buffer.byteLength(receipt.output, 'utf-8')).toBeLessThanOrEqual(16 * 1024)
    expect(receipt.output.endsWith('€')).toBe(true)
    expect(receipt.output.includes('\uFFFD')).toBe(false)
  })

  it('dedupe shares a run only for identical inputs — a new pack version gets its own check', async () => {
    const counter = join(testDir, 'count2.txt')
    const sha = script(binDir, 'verprobe', `echo x >> "${counter}"; sleep 0.2; exit 0`)
    const v1 = binManifest('verprobe', sha)
    const v2 = { ...v1, version: '2.0.1' } as SkillPackManifest
    await Promise.all([verifyLogin({ manifest: v1 }), verifyLogin({ manifest: v2 })])
    expect(readFileSync(counter, 'utf-8').trim().split('\n')).toHaveLength(2)
  })

  it('an aliased install files its receipt under the INSTALLED id', async () => {
    const sha = script(binDir, 'aliasprobe', 'exit 0')
    await verifyLogin({ manifest: binManifest('aliasprobe', sha), packId: 'work-gw' })
    expect(readLoginReceipt('work-gw', 'Google account')?.status).toBe('ok')
    expect(readLoginReceipt('gw', 'Google account')).toBeNull()
  })
})
