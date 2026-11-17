/**
 * The killable `expect` matcher (login-verify's one regex seam). A pack's
 * pattern runs in a child the server SIGKILLs at the deadline — the event
 * loop must stay free while a catastrophic pattern burns (PR1 Codex r4 B1).
 */
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, mock } from 'bun:test'

const testDir = join(tmpdir(), `bakin-test-expect-match-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts), resetOpenClawHome: () => {} }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

import { EXPECT_MATCH_ANSWER_CAP_BYTES, EXPECT_MATCH_CAPTURE_LIMIT, EXPECT_MATCH_COMMAND, EXPECT_MATCH_DEADLINE_EXIT, dispatchExpectMatch, expectMatchArgv, matchExpect, runExpectMatchChild, summarizeExpect } from '../../src/core/agent-packages/expect-match'

const GOG = '"email":\\s*"([^"]+)"[^}]*"valid":\\s*true'
const CATASTROPHIC = 'a*a*a*a*a*a*a*a*b'

describe('summarizeExpect (the child side)', () => {
  it('counts every match and keeps the distinct non-empty first captures in order; an unmatched or absent group captures nothing', () => {
    expect(summarizeExpect('a(b)?', 'a ab ab', 256)).toEqual({ matched: 3, captures: ['b'], wantedFound: false })
    expect(summarizeExpect('zzz', 'a ab', 256)).toEqual({ matched: 0, captures: [], wantedFound: false })
    expect(summarizeExpect('ab', 'ab ab', 256)).toEqual({ matched: 2, captures: [], wantedFound: false })
    expect(summarizeExpect('(?:a)(b)|(?:c)', 'cab', 256)).toEqual({ matched: 2, captures: ['b'], wantedFound: false })
  })

  it('the wanted account is decided over every match, exactly, past the display cap (Codex r6 B5)', () => {
    const listing = Array.from({ length: 300 }, (_, i) => `u${i}@x`).join(' ')
    expect(summarizeExpect('(u\\d+@x)', listing, 256, 'u299@x')).toMatchObject({ matched: 300, wantedFound: true })
    expect(summarizeExpect('(u\\d+@x)', listing, 256, 'u299@x').captures).toHaveLength(256)
    expect(summarizeExpect('(u\\d+@x)', listing, 256, 'u29@').wantedFound).toBe(false)
    expect(summarizeExpect('(u\\d+@x)', listing, 256, '299@x').wantedFound).toBe(false)
    expect(summarizeExpect('(u\\d+@x)', listing, 256).wantedFound).toBe(false)
  })

  it('a zero-width pattern terminates (matchAll advances past empty matches)', () => {
    expect(summarizeExpect('x*', 'ab', 256).matched).toBe(3)
  })

  it('the answer cannot grow with the pattern: lookahead captures over 16 KB stay one capped list', () => {
    const summary = summarizeExpect('(?=(a*))', 'a'.repeat(16 * 1024), EXPECT_MATCH_CAPTURE_LIMIT)
    expect(summary.matched).toBe(16 * 1024 + 1)
    expect(summary.captures).toHaveLength(EXPECT_MATCH_CAPTURE_LIMIT)
  })

  it('the gog pattern keeps each account in its own object: an invalid first account never lends its email', () => {
    const out = '{"accounts":[{"email":"old@example.com","auth":"oauth","valid":false,"error":"revoked"},{"email":"new@example.com","auth":"oauth","valid":true}]}'
    expect(summarizeExpect(GOG, out, 256)).toEqual({ matched: 1, captures: ['new@example.com'], wantedFound: false })
    expect(summarizeExpect(GOG, out, 256, 'old@example.com').wantedFound).toBe(false)
    expect(summarizeExpect(GOG, out, 256, 'new@example.com').wantedFound).toBe(true)
  })
})

describe('runExpectMatchChild (the protocol)', () => {
  function run(stdin: string): Promise<{ code: number; out: string; err: string }> {
    let out = ''
    let err = ''
    return runExpectMatchChild(stdin, async (t) => { out += t }, async (t) => { err += t }).then((code) => ({ code, out, err }))
  }

  it('answers one JSON document for one JSON request', async () => {
    const { code, out } = await run(JSON.stringify({ pattern: 'a(b)', input: 'ab ab', deadlineMs: 5_000 }))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({ matched: 2, captures: ['b'], wantedFound: false })
    const wanted = await run(JSON.stringify({ pattern: 'a(b)', input: 'ab ab', deadlineMs: 5_000, wanted: 'b' }))
    expect(JSON.parse(wanted.out)).toEqual({ matched: 2, captures: ['b'], wantedFound: true })
    expect((await run(JSON.stringify({ pattern: 'a', input: 'a', deadlineMs: 5_000, wanted: 7 }))).code).toBe(1)
  })

  it('a malformed request or a pattern that does not compile is exit 1 on stderr, never a throw', async () => {
    expect((await run('not json')).code).toBe(1)
    expect((await run('{"pattern":1,"input":"x","deadlineMs":5000}')).code).toBe(1)
    expect((await run('{"pattern":"x","input":"x"}')).code).toBe(1)
    const bad = await run(JSON.stringify({ pattern: '(', input: 'x', deadlineMs: 5_000 }))
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('Invalid regular expression')
  })

  it('dispatch answers only when argv names the hidden command', async () => {
    expect(await dispatchExpectMatch(['bun', 'server.ts', 'serve'])).toBeNull()
    expect(expectMatchArgv()[0]).toBe(process.execPath)
    // On a checkout the child is this module as a script, not the binary's command.
    expect(expectMatchArgv()[1]).toMatch(/expect-match\.ts$/)
    expect(EXPECT_MATCH_COMMAND).toBe('__bakin-expect-match')
  })
})

describe('matchExpect (the killable child)', () => {
  it('matches through the real child and returns every match', async () => {
    const result = await matchExpect(GOG, '{"accounts":[{"email":"a@b","valid":false},{"email":"c@d","valid":true},{"email":"e@f","valid":true}]}', { timeoutMs: 10_000 })
    expect(result).toEqual({ ok: true, summary: { matched: 2, captures: ['c@d', 'e@f'], wantedFound: false } })
    const found = await matchExpect(GOG, '{"accounts":[{"email":"c@d","valid":true}]}', { timeoutMs: 10_000, wanted: 'c@d' })
    expect(found).toMatchObject({ ok: true, summary: { wantedFound: true } })
  })

  it('a large answer arrives whole — the child flushes stdout before it exits (Codex r5 B3)', async () => {
    // 2,049 matches with captures up to 2 KB: an unflushed child used to exit 0 mid-write.
    const result = await matchExpect('(?=(a*))', 'a'.repeat(2048), { timeoutMs: 10_000 })
    expect(result).toEqual({ ok: true, summary: { matched: 2049, captures: Array.from({ length: EXPECT_MATCH_CAPTURE_LIMIT }, (_, i) => 'a'.repeat(2048 - i)), wantedFound: false } })
    expect(EXPECT_MATCH_ANSWER_CAP_BYTES).toBeGreaterThan(JSON.stringify(result).length)
  })

  it('a catastrophic pattern is expect-timeout at the deadline, the child is gone, and the event loop never stalled', async () => {
    const marker = `--bakin-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
    let ticks = 0
    const interval = setInterval(() => { ticks += 1 }, 25)
    try {
      const started = Date.now()
      // The child ignores extra argv; the marker makes THIS child findable below.
      const result = await matchExpect(CATASTROPHIC, 'a'.repeat(10_000), { timeoutMs: 600, argv: [...expectMatchArgv(), marker] })
      const elapsed = Date.now() - started
      expect(result).toEqual({ ok: false, reason: 'expect-timeout', detail: 'the pattern did not finish within 600 ms' })
      expect(elapsed).toBeLessThan(3_000)
      // An in-process match would have frozen this interval for the whole wait.
      expect(ticks).toBeGreaterThanOrEqual(10)
    } finally {
      clearInterval(interval)
    }
    const leftover = spawnSync('pgrep', ['-f', marker])
    expect(leftover.stdout.toString().trim()).toBe('')
  })

  it('an ORPHANED child ends itself at its own deadline — a server that died mid-check leaves nothing spinning', async () => {
    const started = Date.now()
    const orphan = spawnSync(expectMatchArgv()[0]!, expectMatchArgv().slice(1), {
      input: JSON.stringify({ pattern: CATASTROPHIC, input: 'a'.repeat(10_000), deadlineMs: 500 }),
      timeout: 10_000,
    })
    expect(orphan.status).toBe(EXPECT_MATCH_DEADLINE_EXIT)
    expect(orphan.stderr.toString()).toContain('did not finish within 500 ms')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('a pattern the child cannot compile, and a matcher that cannot start, are expect-error with the detail', async () => {
    const bad = await matchExpect('(', 'x', { timeoutMs: 10_000 })
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error('unreachable')
    expect(bad.reason).toBe('expect-error')
    expect(bad.detail).toContain('Invalid regular expression')
    const gone = await matchExpect('x', 'x', { timeoutMs: 10_000, argv: [join(testDir, 'no-such-matcher')] })
    expect(gone.ok).toBe(false)
    if (gone.ok) throw new Error('unreachable')
    expect(gone.reason).toBe('expect-error')
    expect(gone.detail).toContain('cannot start the matcher')
  })
})
