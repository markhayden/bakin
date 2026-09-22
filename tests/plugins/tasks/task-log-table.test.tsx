// @vitest-environment jsdom

import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { useState } from 'react'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
let sortQuery = 'completedAt:desc'
mock.module('@makinbakin/sdk/navigation', () => ({
  useQueryState: () => {
    const [value, setValue] = useState(sortQuery)
    return [value, (next: string) => { sortQuery = next; setValue(next) }]
  },
}))

import { TaskLogTable } from '../../../plugins/tasks/components/task-log-table'
import type { FlatTask } from '../../../plugins/tasks/hooks/use-task-filters'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sortQuery = 'completedAt:desc'
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('TaskLogTable', () => {
  it('offers independent edit, duplicate and delete actions in both renders, but not for audit-only rows', async () => {
    vi.stubGlobal('fetch', mock(async () => Response.json({ entries: [
      { type: 'task.created', timestamp: '2026-01-10T12:00:00Z', data: { id: 'old', title: 'Historical task' } },
    ] })))
    const task: FlatTask = { id: 'live', title: 'Live task', checked: false, status: 'review', description: 'Preserve the full task' }
    const onTaskOpen = mock(), onTaskEdit = mock(), onTaskDuplicate = mock(), onTaskDelete = mock()
    render(<TaskLogTable currentTasks={[task]} statusFilter={[]} onTaskOpen={onTaskOpen}
      onTaskEdit={onTaskEdit} onTaskDuplicate={onTaskDuplicate} onTaskDelete={onTaskDelete} />)
    const table = await screen.findByRole('table', { name: 'Task log' })
    const list = screen.getByRole('list', { name: 'Task log' })
    for (const surface of [table, list]) {
      expect(within(surface).queryByRole('button', { name: 'Actions for Historical task' })).toBeNull()
      for (const action of ['Edit', 'Duplicate', 'Delete']) {
        await act(async () => { fireEvent.click(within(surface).getByRole('button', { name: 'Actions for Live task' })) })
        const item = await screen.findByRole('menuitem', { name: action })
        await act(async () => { fireEvent.click(item) })
      }
    }
    expect(onTaskEdit).toHaveBeenCalledTimes(2)
    expect(onTaskEdit).toHaveBeenLastCalledWith(task, 'review')
    expect(onTaskDuplicate).toHaveBeenCalledTimes(2)
    expect(onTaskDuplicate).toHaveBeenLastCalledWith(task, 'review')
    expect(onTaskDelete).toHaveBeenCalledTimes(2)
    expect(onTaskDelete).toHaveBeenLastCalledWith(task)
    expect(onTaskOpen).not.toHaveBeenCalled()
  })

  it('shares the URL sort with its persistent control and labels narrow dates', async () => {
    sortQuery = 'createdAt:asc'
    vi.stubGlobal('fetch', mock(async () => Response.json({ entries: [] })))
    render(<TaskLogTable currentTasks={[
      { id: 'later', title: 'Later', checked: true, status: 'done', date: '2026-01-15T08:00:00-07:00' },
      { id: 'earlier', title: 'Earlier', checked: true, status: 'done', date: '2026-01-15T13:00:00Z' },
      { id: 'unknown', title: 'Unknown date', checked: false, status: 'todo' },
    ]} statusFilter={[]} onTaskOpen={mock()} />)
    const table = await screen.findByRole('table', { name: 'Task log' })
    expect(within(table).getAllByRole('row')[1]?.textContent).toContain('Earlier')
    expect(screen.getByRole('combobox', { name: 'Sort task log' }).textContent).toContain('Created: oldest first')
    const list = screen.getByRole('list', { name: 'Task log' })
    expect(list.getAttribute('data-variant')).toBe('separated')
    expect(within(list).getAllByText('Created').length).toBe(3)
    expect(within(list).getAllByText('—')).toHaveLength(2)
    expect(within(table).getAllByRole('row').at(-1)?.textContent).toContain('Unknown date')
    await act(async () => { fireEvent.click(within(table).getByRole('button', { name: 'Created' })) })
    expect(sortQuery).toBe('createdAt:desc')
    expect(within(table).getAllByRole('row')[1]?.textContent).toContain('Later')
  })

  it('does not advertise manual sorting while search relevance owns the order', async () => {
    vi.stubGlobal('fetch', mock(async () => Response.json({ entries: [
      { type: 'task.created', timestamp: '2026-01-10T12:00:00Z', data: { id: 'unrelated', title: 'Unrelated history' } },
    ] })))
    render(<TaskLogTable currentTasks={[{ id: 'a', title: 'Result', checked: false, status: 'todo' }]} statusFilter={[]} isSearching onTaskOpen={mock()} />)
    const table = await screen.findByRole('table', { name: 'Task log' })
    expect(within(table).queryByRole('button', { name: 'Title' })).toBeNull()
    expect(screen.getByText('Sorted by search relevance')).toBeDefined()
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).queryByText('Unrelated history')).toBeNull()
  })

  it('exposes the task log as a named sortable table', async () => {
    vi.stubGlobal('fetch', mock(async () => new Response(JSON.stringify({ entries: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
    const tasks: FlatTask[] = [
      {
        id: 'task-zebra',
        title: 'Zebra release',
        checked: false,
        status: 'todo',
      },
      {
        id: 'task-alpha',
        title: 'Alpha release',
        checked: false,
        status: 'review',
      },
    ]

    render(
      <TaskLogTable
        currentTasks={tasks}
        statusFilter={[]}
        onTaskOpen={mock()}
      />,
    )

    const table = await screen.findByRole('table', { name: 'Task log' })
    const titleHeader = within(table).getByRole('columnheader', { name: 'Title' })
    await act(async () => { fireEvent.click(within(titleHeader).getByRole('button', { name: 'Title' })) })

    expect(titleHeader.getAttribute('aria-sort')).toBe('descending')
    expect(within(table).getAllByRole('row')[1]?.textContent).toContain('Zebra release')

    await act(async () => { fireEvent.click(within(titleHeader).getByRole('button', { name: 'Title' })) })
    expect(titleHeader.getAttribute('aria-sort')).toBe('ascending')
    expect(within(table).getAllByRole('row')[1]?.textContent).toContain('Alpha release')
  })

  it('uses canonical loading and empty states', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', mock(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })))

    const { container } = render(
      <TaskLogTable
        currentTasks={[]}
        statusFilter={[]}
        onTaskOpen={mock()}
      />,
    )

    expect(container.querySelector('[data-slot="system-state"][data-kind="loading"]')).toBeTruthy()

    resolveFetch?.(new Response(JSON.stringify({ entries: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await waitFor(() => {
      expect(container.querySelector('[data-slot="system-state"][data-kind="initial-empty"]')).toBeTruthy()
    })
  })

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

    // The narrow list render repeats the title action, so scope to the table.
    const table = await screen.findByRole('table', { name: 'Task log' })
    const titleAction = within(table).getByRole('button', { name: 'Open Publish launch announcement' })
    const row = titleAction.closest('tr')
    expect(row).toBeTruthy()

    fireEvent.click(row!)
    expect(onTaskOpen).toHaveBeenLastCalledWith(task, 'review')

    onTaskOpen.mockClear()
    fireEvent.click(titleAction)
    await waitFor(() => expect(onTaskOpen).toHaveBeenCalledWith(task, 'review'))
  })
})
