/**
 * Domain-event fan-in (#191) — Schedule discovers `{pluginId}.scheduledEvents`
 * hooks by suffix, invokes each in parallel under a timeout, zod-validates at
 * the boundary, and DROPS a failing/invalid/slow/lying provider from that
 * response (named in droppedProviders) — a broken plugin never breaks the
 * calendar. Pure DI over the hook surface.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-domain-events-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, mock } from 'bun:test'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { collectDomainEvents, type DomainEventsDeps } from '@bakin/schedule/lib/domain-events'
import type { ScheduledDomainEvent } from '@makinbakin/sdk'

const RANGE = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-08T00:00:00.000Z' }

function event(overrides: Partial<ScheduledDomainEvent> = {}): ScheduledDomainEvent {
  return {
    id: 'evt-1',
    pluginId: 'tasks',
    title: 'Waiting task',
    startsAt: '2026-07-03T15:00:00.000Z',
    kind: 'task-scheduled',
    url: '/tasks?taskId=t1',
    ...overrides,
  }
}

function deps(providers: Record<string, (data: unknown) => Promise<unknown>>, timeoutMs = 200): DomainEventsDeps {
  return {
    hooks: {
      getRegisteredHooks: () => [...Object.keys(providers), 'team.resolveAssignment', 'schedule.ensureBakinJob'],
      invoke: async <R,>(name: string, data: unknown) => {
        const handler = providers[name]
        return handler ? (await handler(data)) as R : undefined
      },
    },
    timeoutMs,
  }
}

describe('collectDomainEvents', () => {
  it('discovers providers by suffix and merges their validated events sorted by primary date', async () => {
    const { events, droppedProviders } = await collectDomainEvents(RANGE.from, RANGE.to, deps({
      'tasks.scheduledEvents': async (query) => {
        expect(query).toEqual(RANGE)
        return [
          event({ id: 'later', startsAt: '2026-07-05T00:00:00.000Z' }),
          event({ id: 'due', startsAt: undefined, dueAt: '2026-07-02T00:00:00.000Z', kind: 'task-due' }),
        ]
      },
      'messaging.scheduledEvents': async () => [
        event({ id: 'post', pluginId: 'messaging', kind: 'publish', startsAt: '2026-07-04T00:00:00.000Z' }),
      ],
    }))
    expect(droppedProviders).toEqual([])
    expect(events.map(e => e.id)).toEqual(['due', 'post', 'later'])
  })

  it('drops a throwing provider, keeps the rest, names the casualty', async () => {
    const { events, droppedProviders } = await collectDomainEvents(RANGE.from, RANGE.to, deps({
      'tasks.scheduledEvents': async () => [event()],
      'broken.scheduledEvents': async () => { throw new Error('provider exploded') },
    }))
    expect(events).toHaveLength(1)
    expect(droppedProviders).toEqual(['broken'])
  })

  it('drops a provider returning invalid rows (missing both dates)', async () => {
    const { events, droppedProviders } = await collectDomainEvents(RANGE.from, RANGE.to, deps({
      'sloppy.scheduledEvents': async () => [event({ pluginId: 'sloppy', startsAt: undefined, dueAt: undefined })],
    }))
    expect(events).toEqual([])
    expect(droppedProviders).toEqual(['sloppy'])
  })

  it('drops a provider lying about its pluginId (spoofed ownership)', async () => {
    const { events, droppedProviders } = await collectDomainEvents(RANGE.from, RANGE.to, deps({
      'imposter.scheduledEvents': async () => [event({ pluginId: 'tasks' })],
    }))
    expect(events).toEqual([])
    expect(droppedProviders).toEqual(['imposter'])
  })

  it('drops a provider that exceeds the timeout', async () => {
    const { events, droppedProviders } = await collectDomainEvents(RANGE.from, RANGE.to, deps({
      'slow.scheduledEvents': () => new Promise(resolve =>
        setTimeout(() => resolve([event({ pluginId: 'slow' })]), 150)),
      'tasks.scheduledEvents': async () => [event()],
    }, 50))
    expect(events).toHaveLength(1)
    expect(events[0]!.pluginId).toBe('tasks')
    expect(droppedProviders).toEqual(['slow'])
  })

  it('returns an empty feed with no providers registered', async () => {
    const { events, droppedProviders } = await collectDomainEvents(RANGE.from, RANGE.to, deps({}))
    expect(events).toEqual([])
    expect(droppedProviders).toEqual([])
  })

  it('rejects malformed date strings', async () => {
    const { droppedProviders } = await collectDomainEvents(RANGE.from, RANGE.to, deps({
      'tasks.scheduledEvents': async () => [event({ startsAt: 'next tuesday-ish' })],
    }))
    expect(droppedProviders).toEqual(['tasks'])
  })
})
