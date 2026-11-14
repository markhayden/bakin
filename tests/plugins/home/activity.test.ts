/** The everyday Home's activity summary: pure, from what Tasks, Chat and Schedule answer. */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-home-activity-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { PICK_UP_LIMIT, summarizeActivity, WEEK_MS } from '../../../plugins/home/lib/client/activity'

const NOW = Date.parse('2026-11-13T12:00:00.000Z')
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()
const HOUR = 60 * 60 * 1000
const NOTHING = { columns: {}, chats: [], occurrences: [], jobs: 0, projects: null }

describe('summarizeActivity', () => {
  it('a home where nothing has been done has no work to show', () => {
    expect(summarizeActivity(NOTHING, NOW)).toEqual({
      hasWork: false, tasks: { planned: 0, inProgress: 0, completed: 0, blocked: 0 }, projects: null, scheduled: { jobs: 0, comingUp: 0 }, pickUp: [],
    })
  })

  it('tasks Bakin opened for itself are not the person\'s work', () => {
    const summary = summarizeActivity({ ...NOTHING, columns: { inProgress: [{ id: 'h1', title: 'Health: search is down', createdBy: 'system', updatedAt: NOW }], done: [{ id: 'h2', title: 'Health: fixed', createdBy: 'system', updatedAt: NOW }] } }, NOW)
    expect(summary).toMatchObject({ hasWork: false, tasks: { planned: 0, inProgress: 0, completed: 0, blocked: 0 }, pickUp: [] })
  })

  it('counts the board the way a person would, the schedule, and projects when there are any', () => {
    const summary = summarizeActivity({
      columns: {
        todo: [{ id: 't0', title: 'Not started', updatedAt: NOW }],
        inProgress: [{ id: 't1', title: 'Launch plan', updatedAt: NOW - HOUR }],
        review: [{ id: 't2', title: 'Draft post', updatedAt: NOW - 2 * HOUR }],
        blocked: [{ id: 't3', title: 'Needs a key', updatedAt: NOW - 3 * HOUR }],
        done: [{ id: 'd1', title: 'Yesterday', updatedAt: NOW - 24 * HOUR }, { id: 'd2', title: 'Last month', updatedAt: NOW - 5 * WEEK_MS }, { id: 'd3', title: 'No time' }],
      },
      chats: [],
      occurrences: [{ at: iso(HOUR), past: false }, { at: iso(-HOUR), past: true }, { at: iso(WEEK_MS + HOUR), past: false }, { at: 'whenever', past: false }],
      jobs: 2,
      projects: 0,
    }, NOW)
    // Planned is backlog + todo; in progress includes what is waiting in review.
    expect(summary).toMatchObject({ hasWork: true, tasks: { planned: 1, inProgress: 2, completed: 3, blocked: 1 }, scheduled: { jobs: 2, comingUp: 1 }, projects: 0 })
  })

  it('recent activity is the newest tasks and chats together, each with where it leads; a chat counts from when it was last opened', () => {
    const summary = summarizeActivity({
      columns: { review: [{ id: 't2', title: 'Draft post', updatedAt: NOW - 2 * HOUR }], done: [{ id: 'd1', title: 'Finished', updatedAt: NOW - 3 * HOUR }] },
      chats: [
        { id: 'c1', title: 'Avatar ideas', updatedAt: iso(-HOUR), lastMessagePreview: 'Done, option 3 it is.' },
        // Its last message is old, but it was opened a moment ago.
        { id: 'c2', title: 'Older chat', updatedAt: iso(-48 * HOUR), lastSeenAt: iso(-60_000) },
      ],
      occurrences: [], jobs: 0, projects: null,
    }, NOW)
    expect(summary.pickUp).toEqual([
      { key: 'chat:c2', kind: 'chat', title: 'Older chat', detail: 'Chat', href: '/chat/c2', at: NOW - 60_000 },
      { key: 'chat:c1', kind: 'chat', title: 'Avatar ideas', detail: 'Chat · Done, option 3 it is.', href: '/chat/c1', at: NOW - HOUR },
      { key: 'task:t2', kind: 'task', title: 'Draft post', detail: 'Task · Waiting on you', href: '/tasks?taskId=t2', at: NOW - 2 * HOUR },
      { key: 'task:d1', kind: 'task', title: 'Finished', detail: 'Task · Completed', href: '/tasks?taskId=d1', at: NOW - 3 * HOUR },
    ])
  })

  it('a single chat is enough to count as work, and the list stops at five', () => {
    const chats = Array.from({ length: 8 }, (_, index) => ({ id: `c${index}`, title: `Chat ${index}`, updatedAt: iso(-index * HOUR) }))
    const summary = summarizeActivity({ ...NOTHING, chats }, NOW)
    expect(summary.hasWork).toBe(true)
    expect(summary.pickUp).toHaveLength(PICK_UP_LIMIT)
    expect(summary.pickUp[0]!.key).toBe('chat:c0')
  })
})
