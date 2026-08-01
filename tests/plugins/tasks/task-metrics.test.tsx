// @vitest-environment jsdom

import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-task-metrics-${process.pid}-${Date.now()}`)

function getTestPaths() {
  return {
    root: testDir,
    db: join(testDir, 'bakin.db'),
  }
}

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: getTestPaths,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: getTestPaths,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: getTestPaths,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

import { TaskMetrics } from '../../../plugins/tasks/components/task-metrics'
import type { Task, TaskColumns } from '../../../plugins/tasks/types'

afterEach(cleanup)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, checked: false, ...overrides }
}

describe('TaskMetrics', () => {
  it('uses the canonical dense metric pattern with non-color labels', () => {
    const today = new Date().toISOString().slice(0, 10)
    const columns: TaskColumns = {
      backlog: [task('backlog')],
      todo: [task('todo')],
      blocked: [task('blocked')],
      inProgress: [task('running', { agent: 'margo' })],
      review: [task('review', { agent: 'rolo' })],
      done: [task('done', { date: `${today}T08:00:00.000Z` })],
      archived: [task('archived', { date: '2025-01-01T08:00:00.000Z' })],
    }

    const { container } = render(<TaskMetrics columns={columns} timestamp="Today 10:43 AM" />)

    expect(screen.getByRole('group', { name: 'Task summary metrics' })).toBeTruthy()
    expect(container.querySelector('[data-stat-group]')).toBeTruthy()
    expect(container.querySelectorAll('[data-stat-tile]')).toHaveLength(5)
    expect(screen.getByText('Active').closest('[data-stat-tile]')?.textContent).toContain('2')
    expect(screen.getByText('Blocked').closest('[data-stat-tile]')?.getAttribute('data-value-tone')).toBe('danger')
    expect(screen.getByText('Done today').closest('[data-stat-tile]')?.getAttribute('data-value-tone')).toBe('success')
    expect(screen.getByText('Updated Today 10:43 AM')).toBeTruthy()
  })
})
