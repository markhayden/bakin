/**
 * Tests for plugins/memory/lib/openclaw-cli.ts — thin wrapper for
 * `openclaw memory status --json` and `openclaw memory search --json`.
 *
 * Uses child_process execFile mocking. Production code calls execFile only;
 * never shell exec (avoids shell-injection surface even though we build
 * args by hand).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-cli-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    openclaw: {
      binaryPath: '/fake/bin/openclaw',
      gatewayUrl: 'http://localhost',
      gatewayPort: 18789,
    },
  }),
}))

// Mock child_process.execFile. Tests reconfigure the behavior per case.
type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void
type ExecFileCall = {
  cmd: string
  args: string[]
  options: { timeout?: number; maxBuffer?: number }
}

let lastCall: ExecFileCall | null = null
let nextResult: { stdout?: string; stderr?: string; err?: Error } = { stdout: '{}' }

mock.module('child_process', () => ({
  execFile: (cmd: string, args: string[], options: { timeout?: number; maxBuffer?: number }, cb: ExecFileCallback) => {
    lastCall = { cmd, args, options }
    const { stdout = '', stderr = '', err = null } = nextResult
    setTimeout(() => cb(err, stdout, stderr), 0)
  },
}))

import {
  memoryStatus,
  memorySearch,
  MemoryCliError,
  __setOpenclawCliExecFileForTests,
} from '../../../plugins/memory/lib/openclaw-cli'

beforeEach(() => {
  lastCall = null
  nextResult = { stdout: '{}' }
})

afterAll(() => {
  __setOpenclawCliExecFileForTests(null)
})

// ─── memoryStatus ────────────────────────────────────────────────────────────

describe('memoryStatus', () => {
  it('invokes `openclaw memory status --json` with execFile', async () => {
    nextResult = { stdout: JSON.stringify({ ready: true, docs: 42 }) }
    const result = await memoryStatus()
    expect(lastCall).toBeTruthy()
    expect(lastCall!.cmd).toBe('/fake/bin/openclaw')
    expect(lastCall!.args).toEqual(['memory', 'status', '--json'])
    expect(result).toEqual({ ready: true, docs: 42 })
  })

  it('applies a 15s default timeout', async () => {
    nextResult = { stdout: '{}' }
    await memoryStatus()
    expect(lastCall!.options.timeout).toBe(15_000)
  })

  it('throws MemoryCliError on non-JSON stdout', async () => {
    nextResult = { stdout: 'not json at all' }
    await expect(memoryStatus()).rejects.toBeInstanceOf(MemoryCliError)
  })

  it('throws MemoryCliError when execFile reports an error', async () => {
    nextResult = { err: new Error('command failed'), stdout: '', stderr: 'boom' }
    await expect(memoryStatus()).rejects.toBeInstanceOf(MemoryCliError)
  })
})

// ─── memorySearch ────────────────────────────────────────────────────────────

describe('memorySearch', () => {
  it('passes --query and --json to the CLI', async () => {
    nextResult = { stdout: JSON.stringify({ results: [] }) }
    await memorySearch('hello world')
    expect(lastCall!.args).toEqual(['memory', 'search', '--query', 'hello world', '--json'])
  })

  it('passes --agent when provided', async () => {
    nextResult = { stdout: JSON.stringify({ results: [] }) }
    await memorySearch('hi', { agent: 'pixel' })
    expect(lastCall!.args).toContain('--agent')
    expect(lastCall!.args[lastCall!.args.indexOf('--agent') + 1]).toBe('pixel')
  })

  it('passes --limit when provided', async () => {
    nextResult = { stdout: JSON.stringify({ results: [] }) }
    await memorySearch('hi', { limit: 5 })
    expect(lastCall!.args).toContain('--limit')
    expect(lastCall!.args[lastCall!.args.indexOf('--limit') + 1]).toBe('5')
  })

  it('returns an empty-results shape when stdout is empty', async () => {
    nextResult = { stdout: '' }
    const result = await memorySearch('hi')
    expect(result).toEqual({ results: [] })
  })

  it('rejects empty queries', async () => {
    await expect(memorySearch('')).rejects.toBeInstanceOf(MemoryCliError)
    await expect(memorySearch('   ')).rejects.toBeInstanceOf(MemoryCliError)
  })

  it('forwards custom timeoutMs', async () => {
    nextResult = { stdout: JSON.stringify({ results: [] }) }
    await memorySearch('hi', { timeoutMs: 3000 })
    expect(lastCall!.options.timeout).toBe(3000)
  })
})
