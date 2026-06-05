/**
 * Whiskit system-bun runner (Phase 2): argv exec, env allowlist, output
 * caps, timeout kill, sanitized failures. Uses real `bun -e` subprocesses —
 * fast, no network. Mandatory isolation mocks per project rule.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync } from 'fs'

const mockDir = join(tmpdir(), `whiskit-command-mock-${Date.now()}-${randomUUID()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(mockDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(mockDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { commandFailure, findSystemBun, runSystemBun } from '../../../src/core/whiskit/command'
import { WhiskitBuildError } from '../../../src/core/whiskit/types'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.BAKIN_BUN_PATH
  delete process.env.WHISKIT_TEST_SECRET
})
function freshDir(): string {
  const d = join(tmpdir(), `whiskit-cmd-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

describe('findSystemBun', () => {
  it('honors the BAKIN_BUN_PATH override', () => {
    process.env.BAKIN_BUN_PATH = '/custom/bin/bun'
    expect(findSystemBun()).toBe('/custom/bin/bun')
  })

  it('falls back to PATH lookup', () => {
    expect(findSystemBun()).toContain('bun')
  })
})

describe('runSystemBun', () => {
  it('runs bun with argv array and captures stdout', async () => {
    const result = await runSystemBun(['-e', 'console.log("hello-whiskit")'], { cwd: freshDir() })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('hello-whiskit')
    expect(result.timedOut).toBe(false)
  })

  it('captures stderr and the non-zero exit code without rejecting', async () => {
    const result = await runSystemBun(['-e', 'console.error("boom-detail"); process.exit(3)'], { cwd: freshDir() })
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('boom-detail')
  })

  it('withholds non-allowlisted env vars from the subprocess', async () => {
    process.env.WHISKIT_TEST_SECRET = 'super-secret'
    const result = await runSystemBun(
      ['-e', 'console.log(JSON.stringify({ secret: process.env.WHISKIT_TEST_SECRET ?? null, path: !!process.env.PATH }))'],
      { cwd: freshDir() },
    )
    const parsed = JSON.parse(result.stdout.trim()) as { secret: string | null; path: boolean }
    expect(parsed.secret).toBeNull()
    expect(parsed.path).toBe(true) // PATH is allowlisted — bun needs it
  })

  it('layers extraEnv over the allowlist', async () => {
    const result = await runSystemBun(
      ['-e', 'console.log(process.env.NODE_ENV)'],
      { cwd: freshDir(), extraEnv: { NODE_ENV: 'production' } },
    )
    expect(result.stdout.trim()).toBe('production')
  })

  it('kills a hung process at the timeout', async () => {
    const result = await runSystemBun(
      ['-e', 'await new Promise(() => {})'],
      { cwd: freshDir(), timeoutMs: 500 },
    )
    expect(result.timedOut).toBe(true)
    expect(result.durationMs).toBeLessThan(10_000)
  })

  it('caps runaway output instead of buffering it all', async () => {
    const result = await runSystemBun(
      ['-e', 'const line = "x".repeat(1024); for (let i = 0; i < 1024; i++) console.log(line)'],
      { cwd: freshDir() },
    )
    expect(result.stdout.length).toBeLessThan(300 * 1024)
    expect(result.stdout).toContain('[output truncated]')
  })
})

describe('commandFailure', () => {
  it('builds a bounded, stage-tagged error from a failed result', () => {
    const err = commandFailure('server-build', 'Server build for "demo"', {
      exitCode: 1,
      stdout: '',
      stderr: Array.from({ length: 60 }, (_, i) => `line-${i}`).join('\n'),
      timedOut: false,
      durationMs: 1234,
    })
    expect(err).toBeInstanceOf(WhiskitBuildError)
    expect(err.stage).toBe('server-build')
    expect(err.message).toContain('exited with code 1')
    expect(err.message).toContain('line-59') // stderr tail kept
    expect(err.message).not.toContain('line-0') // head trimmed
  })

  it('reports timeouts as timeouts', () => {
    const err = commandFailure('install', 'Dependency install', {
      exitCode: 124,
      stdout: '',
      stderr: '',
      timedOut: true,
      durationMs: 120_000,
    })
    expect(err.message).toContain('timed out after 120s')
  })
})
