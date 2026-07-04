/**
 * Read-only CLI TTY commands — status, settings, and paths. Split from
 * readonly-commands.test.ts (B7).
 */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

// These flows are HTTP-only (fetch is mocked), but the isolation mocks are
// mandatory insurance: nothing this test transitively imports may ever
// resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-readonly-settings-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const harness = setupTtyCliHarness({ defaultFetchJson: { ok: true } })
const { fetchMock, output, jsonResponse } = harness

describe('read-only CLI TTY commands — status, settings, paths', () => {
  it('renders status with the shared TUI when stdout is a TTY', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        intervalMin: 5,
        lastRun: '2026-05-18T04:00:00.000Z',
        nextRun: '2026-05-18T04:05:00.000Z',
        secondsUntilNext: 120,
        dispatchedCount: 7,
      }))
      .mockResolvedValueOnce(jsonResponse({ agents: [{ id: 'main' }, { id: 'patch' }], mainAgentId: 'main' }))
    process.argv = ['bun', 'cli/bakin.ts', 'status']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain("┃ 🐷 Bakin'")
    expect(output()).toContain('Status')
    expect(output()).toContain('DISPATCH')
    expect(output()).not.toContain('=== Bakin Status ===')
  })

  it('renders setup configuration summaries with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      dispatch: { intervalMs: 300000, maxRetries: 3 },
      runtime: { adapter: 'openclaw' },
      plugins: { requireSignatures: false },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'get']
    await main()
    expect(output()).toContain('Settings')
    expect(output()).toContain('CONFIGURATION')
    expect(output()).toContain('dispatch.intervalMs')
    expect(output()).not.toContain('"dispatch"')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      isBakinHome: true,
      paths: {
        home: '/Users/roscoe/.bakin',
        tasks: '/Users/roscoe/.bakin/tasks',
        audit: '/Users/roscoe/.bakin/audit.jsonl',
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'paths']
    await main()
    expect(output()).toContain('Paths')
    expect(output()).toContain('DIRECTORIES')
    expect(output()).toContain('/Users/roscoe/.bakin')
    expect(output()).not.toContain('Content dir:')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      dispatch: { intervalMs: 300000, maxRetries: 3 },
      runtime: { adapter: 'openclaw' },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'get', 'dispatch.intervalMs']
    await main()
    expect(output()).toContain('Settings')
    expect(output()).toContain('dispatch.intervalMs')
    expect(output()).toContain('300000')
    expect(output()).toContain('CONFIGURATION')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'set', 'dispatch.intervalMs', '300000']
    await main()
    expect(output()).toContain('Settings action')
    expect(output()).toContain('Updated setting dispatch.intervalMs.')
    expect(output()).toContain('Value: 300000')
    expect(output()).not.toContain('"ok": true')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      dispatch: { intervalMs: 300000, maxRetries: 3 },
      runtime: { adapter: 'openclaw' },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'get', 'dispatch.intervalMin', '--json']
    await main()
    expect(output()).toBe('null')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      path: '/Users/roscoe/.bakin/assets',
      isBakinHome: true,
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'paths', 'assets']
    await main()
    expect(output()).toContain('Paths')
    expect(output()).toContain('assets')
    expect(output()).toContain('/Users/roscoe/.bakin/assets')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/Users/roscoe/.bakin/assets' }))
    process.argv = ['bun', 'cli/bakin.ts', 'paths', 'assets', '--json']
    await main()
    expect(output()).toContain('"path": "/Users/roscoe/.bakin/assets"')
    expect(output()).not.toContain('Paths')
  })
})
