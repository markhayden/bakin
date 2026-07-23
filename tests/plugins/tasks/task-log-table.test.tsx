// @vitest-environment jsdom

import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-task-log-table-${process.pid}-${Date.now()}`)

function getTestPaths() {
  return { root: testDir, db: join(testDir, 'bakin.db') }
}

mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: getTestPaths }))
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: getTestPaths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: getTestPaths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('@/core/watcher', () => ({ registerSyncHook: mock(), registerUnlinkHook: mock() }))
mock.module('@makinbakin/sdk/hooks', () => ({ useAgent: () => ({ name: 'Margo' }) }))

import { TaskLogTable } from '../../../plugins/tasks/components/task-log-table'
import type { FlatTask } from '../../../plugins/tasks/hooks/use-task-filters'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('TaskLogTable', () => {
  it('opens the existing task drawer from the row and exposes a keyboard action', async () => {
    vi.stubGlobal('fetch', mock(async () => new Response(JSON.stringify({ entries: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
    const onTaskOpen = mock()
    const task: FlatTask = {
      id: 'task-launch',
      title: 'Publish launch announcement',
      checked: false,
      agent: 'margo',
      status: 'review',
    }

    render(
      <TaskLogTable
        currentTasks={[task]}
        statusFilter={[]}
        onTaskOpen={onTaskOpen}
      />,
    )

    const titleAction = await screen.findByRole('button', { name: 'Open Publish launch announcement' })
    const row = titleAction.closest('tr')
    expect(row).toBeTruthy()

    fireEvent.click(row!)
    expect(onTaskOpen).toHaveBeenLastCalledWith(task, 'review')

    onTaskOpen.mockClear()
    fireEvent.click(titleAction)
    await waitFor(() => expect(onTaskOpen).toHaveBeenCalledWith(task, 'review'))
  })
})
