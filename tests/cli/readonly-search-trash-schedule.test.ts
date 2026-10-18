/**
 * Read-only CLI TTY commands — schedule, trash, docs, search, and reindex.
 * Split from readonly-commands.test.ts (B7).
 */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'
import { TEST_BOOT_ID, finishedOperation } from '../helpers/operation-fetch'

// These flows are HTTP-only (fetch is mocked), but the isolation mocks are
// mandatory insurance: nothing this test transitively imports may ever
// resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-readonly-search-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const harness = setupTtyCliHarness({ defaultFetchJson: { ok: true } })
const { fetchMock, output, errorOutput, jsonResponse } = harness

describe('read-only CLI TTY commands — schedule, trash, search', () => {
  it('renders schedule list and run history with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      jobs: [
        {
          id: 'job-1',
          displayName: 'Daily Doctor',
          agentId: 'main',
          humanSchedule: 'Every day at 9:00 AM',
          paused: false,
          enabled: true,
          isBakinJob: true,
        },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'schedule', 'list']
    await main()
    expect(output()).toContain('Schedule')
    expect(output()).toContain('JOBS')
    expect(output()).toContain('Daily Doctor')
    expect(output()).not.toContain('Name                      Agent')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      runs: [
        { runId: 'run-1', timestamp: '2026-05-18T09:00:00.000Z', status: 'ok', taskId: 'task-1' },
        { runId: 'run-2', timestamp: '2026-05-17T09:00:00.000Z', status: 'error', error: 'timeout' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'schedule', 'runs', 'job-1']
    await main()
    expect(output()).toContain('Schedule Runs')
    expect(output()).toContain('RUN HISTORY')
    expect(output()).toContain('task-1')
    expect(output()).toContain('timeout')
    expect(output()).not.toContain('Time                   Status')
  })

  it('renders trash list with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [{
        trashName: '20260518-text-doc__deleted-1747558800000',
        assetId: '20260518-text-doc',
        type: 'text',
        agent: 'patch',
        deletedAt: 1747558800000,
        versionCount: 2,
        description: 'a doc',
      }],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'trash', 'list']
    await main()

    expect(output()).toContain('Trash')
    expect(output()).toContain('TRASHED ASSETS')
    expect(output()).toContain('20260518-text-doc')
    expect(output()).toContain('bakin trash restore <trashName>')
    expect(output()).not.toContain('item in trash:')
  })

  it('renders trash action confirmations with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      assetId: '20260518-text-doc',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'trash', 'restore', '20260518-text-doc__deleted-1747558800000']
    await main()
    expect(output()).toContain('Trash action')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Restored 20260518-text-doc.')
    expect(output()).not.toContain('Restored →')

    harness.log.mockClear()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        items: [
          { trashName: 'a__deleted-1', assetId: 'a', type: 'text', agent: 'main', deletedAt: 1, versionCount: 1, description: '' },
          { trashName: 'b__deleted-2', assetId: 'b', type: 'text', agent: 'main', deletedAt: 2, versionCount: 1, description: '' },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, deleted: 2 }))
    process.argv = ['bun', 'cli/bakin.ts', 'trash', 'empty']
    await main()
    expect(output()).toContain('Trash action')
    expect(output()).toContain('Permanently deleted 2 items.')
    expect(output()).toContain('RESULT')
  })

  it('renders docs and search read-only commands with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      routes: [
        { method: 'GET', fullPath: '/api/plugins/tasks/', pluginId: 'tasks', description: 'List tasks' },
        { method: 'POST', fullPath: '/api/plugins/tasks/', pluginId: 'tasks', description: 'Create task' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'docs']
    await main()
    expect(output()).toContain('Docs')
    expect(output()).toContain('ROUTES')
    expect(output()).toContain('/api/plugins/tasks/')
    expect(output()).not.toContain('GET /api/plugins/tasks/')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      results: [
        {
          id: 'task-1',
          score: 0.9123,
          table: 'bakin_tasks',
          fields: { title: 'Blocked task' },
        },
      ],
      aggregations: { status: [{ value: 'blocked', count: 1 }] },
      meta: { query: 'blocked task', total: 1, took_ms: 4, source: 'tantivy' },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'search', 'blocked', 'task', '--table=tasks']
    await main()
    expect(output()).toContain('Search')
    expect(output()).toContain('RESULTS')
    expect(output()).toContain('Blocked task')
    expect(output()).toContain('tasks')
    expect(output()).toContain('task-1')
    expect(output()).toContain('FACETS')
    expect(output()).not.toContain('Search: "blocked task"')

    harness.log.mockClear()
    // Payload = the real SearchHealthSnapshot shape (logical/docCount/legs);
    // the old table/stats fields never existed on the route (2026-07-21).
    fetchMock.mockResolvedValueOnce(jsonResponse({
      enabled: true,
      engineReachable: true,
      outbox: { pending: 0, quarantined: 0, oldestPendingAt: null },
      tables: [
        {
          logical: 'bakin_tasks',
          pluginId: 'tasks',
          docCount: 12,
          lastIndexedAt: null,
          journalPending: 0,
          state: 'active',
          phase: null,
          legs: [],
          healthy: true,
        },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'search:stats']
    await main()
    expect(output()).toContain('Search Stats')
    expect(output()).toContain('TABLES')
    expect(output()).toContain('tasks')
    expect(output()).toContain('12')
    expect(output()).toContain('healthy')
    expect(output()).not.toContain('Search: enabled')
  })

  it('follows the reindex operation, then renders its results with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    const report = {
      ok: false,
      total: 12,
      errors: 1,
      parked: 0,
      tables: [
        { table: 'bakin_tasks', indexed: 12, result: 'migrated' },
        { table: 'agent_lessons', indexed: 0, error: 'schema missing' },
      ],
    }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ operationId: 'op-reindex', bootId: TEST_BOOT_ID }), { status: 202 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      bootId: TEST_BOOT_ID,
      operation: finishedOperation('op-reindex', { httpStatus: 200, body: report }, { status: 'failed', outcome: { code: 'tables_parked', message: '1 failed of 2 tables' } }),
      children: [],
    }), { status: 200 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
    process.argv = ['bun', 'cli/bakin.ts', 'reindex', '--table', 'tasks', '--rebuild']
    // A table that did not converge fails the command after its report.
    await expect(main()).rejects.toThrow('exit:1')

    expect(fetchMock).toHaveBeenCalledWith(
      `${process.env.BAKIN_URL}/api/reindex?table=tasks`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(output()).toContain('Reindex')
    expect(output()).toContain('target: tasks')
    expect(output()).toContain('TABLES')
    expect(output()).toContain('bakin_tasks')
    expect(output()).toContain('agent_lessons')
    expect(output()).toContain('schema missing')
    expect(output()).not.toContain('Reindexing tasks into search')
  })

  it('follows the reset operation and reports its rebuild', async () => {
    const { main } = await import('../../cli/bakin')
    const result = { ok: true, message: 'Engine reset clean and responding.', reindex: { ok: true, errors: 0, parked: 0, total: 5, tables: [] } }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ operationId: 'op-reset', bootId: TEST_BOOT_ID }), { status: 202 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ bootId: TEST_BOOT_ID, operation: finishedOperation('op-reset', { httpStatus: 200, body: result }), children: [] }), { status: 200 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
    process.argv = ['bun', 'cli/bakin.ts', 'search:reset', '--yes']
    await main()

    expect(fetchMock).toHaveBeenCalledWith(`${process.env.BAKIN_URL}/api/search/reset`, expect.objectContaining({ method: 'POST' }))
    expect(output()).toContain('Engine reset clean and responding.')
    expect(output()).toContain('Done. 5 documents reindexed.')
  })

  it('answers a refused reset at once, without following anything', async () => {
    const { main } = await import('../../cli/bakin')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, message: 'Search is disabled in settings — enable it before resetting.', reindex: null }), { status: 409 }))
    process.argv = ['bun', 'cli/bakin.ts', 'search:reset', '--yes']
    await expect(main()).rejects.toThrow('exit:1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(errorOutput()).toContain('Reset failed: Search is disabled in settings')
  })
})
