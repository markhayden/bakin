/**
 * `bakin check <target> --json` and `bakin check all --json` (#908 §4.10):
 * the structured CheckResult (or array) and nothing else on stdout; exit
 * codes unchanged (0 ok, 1 error/missing/broken, 2 warn).
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

const testDir = join(tmpdir(), `bakin-test-check-json-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

let channelsResult = { name: 'channels', status: 'warn', message: 'Discord is enabled but its bot token is missing.', remediation: 'Add the token in Settings → Channels (/settings?tab=channels)', details: { mode: 'server', via: 'http', state: 'missing_token' } }
mock.module('../../src/core/onboarding/credentials', () => ({
  channelsComponent: { name: 'channels', check: async () => channelsResult, install: async () => ({ name: 'channels', status: 'noop', message: 'noop', durationMs: 0 }) },
  llmComponent: { name: 'llm', check: async () => ({ name: 'llm', status: 'ok', message: 'ok' }), install: async () => ({ name: 'llm', status: 'noop', message: 'noop', durationMs: 0 }) },
}))
mock.module('../../src/core/onboarding/index', () => ({
  checkAll: async () => [{ name: 'runtime', status: 'ok', message: 'Runtime ready.' }, channelsResult],
}))

const harness = setupTtyCliHarness({ exitMode: 'always-throws', defaultIsTTY: false, mockFetch: false })

import { run } from '../../src/cli/commands/onboarding'

const exitCode = async (args: string[]) => {
  try {
    await run(args)
  } catch (err) {
    const match = /^exit:(\d+)$/.exec(err instanceof Error ? err.message : String(err))
    if (match) return Number(match[1])
    throw err
  }
  return 0
}

describe('bakin check --json', () => {
  it('check channels --json prints the structured result only and keeps the warn exit code', async () => {
    expect(await exitCode(['check', 'channels', '--json'])).toBe(2)
    const parsed = JSON.parse(harness.output())
    expect(parsed).toMatchObject({ name: 'channels', status: 'warn', details: { mode: 'server', via: 'http', state: 'missing_token' } })
  })

  it('check channels without --json prints the human line and remediation', async () => {
    expect(await exitCode(['check', 'channels'])).toBe(2)
    expect(harness.output()).toContain('[WARN]')
    expect(harness.output()).toContain('→ Add the token in Settings → Channels')
  })

  it('check all --json prints the array and the aggregate exit code', async () => {
    expect(await exitCode(['check', 'all', '--json'])).toBe(2)
    const parsed = JSON.parse(harness.output())
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.map((r: { name: string }) => r.name)).toEqual(['runtime', 'channels'])
    channelsResult = { ...channelsResult, status: 'ok', message: 'Discord bridge connected — 9 channels across 1 server.' }
    expect(await exitCode(['check', 'all', '--json'])).toBe(0)
  })
})
