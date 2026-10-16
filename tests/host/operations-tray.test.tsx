// @vitest-environment jsdom
/**
 * Header operations tray (#895 D14): the list merge under rev/boot guards,
 * hidden when nothing is running or just finished, compact rows, Cancel
 * posting to the cancel route, and live updates from operation.updated.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-host-operations-tray-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { act, cleanup, render, screen, within } from '@testing-library/react'
import { actRender } from '../rtl-settle'
import { emitPluginEvent, useToastStore } from '@makinbakin/sdk/hooks'
import type { OperationView } from '@makinbakin/sdk/types'
import {
  EMPTY_OPERATION_LIST,
  mergeOperationList,
  RECENTLY_FINISHED_MS,
  visibleOperations,
} from '../../packages/host/src/components/operations/operations-list'
import { OperationsTray, OperationsTrayView, trayLabel } from '../../packages/host/src/components/operations/operations-tray'
import { waitUntil } from '../helpers/wait'

const NOW = Date.parse('2026-10-16T12:00:00.000Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

function view(over: Partial<OperationView> = {}): OperationView {
  return {
    id: 'op-1',
    children: [],
    rev: 1,
    bootId: 'boot-a',
    kind: 'install',
    owner: 'core',
    origin: 'web',
    title: 'Install Copywriter',
    fingerprint: 'install:copywriter',
    resources: ['install-state'],
    status: 'running',
    plan: { stages: [{ id: 'fetch', kind: 'downloading', label: 'Download archive' }], pointOfNoReturn: null },
    stages: [{ id: 'fetch', kind: 'downloading', label: 'Download archive', status: 'active', startedAt: iso(5_000), bytes: { received: 5_000_000, total: 10_000_000 } }],
    cancellable: true,
    startedAt: iso(5_000),
    lastProgressAt: iso(0),
    lastLivenessAt: iso(0),
    log: [],
    ...over,
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const originalFetch = globalThis.fetch
beforeEach(() => { useToastStore.setState({ toasts: [] }) })
afterEach(() => {
  globalThis.fetch = originalFetch
  cleanup()
})

describe('mergeOperationList', () => {
  it('keeps the highest rev, drops children, and resets on a new boot', () => {
    let state = mergeOperationList(EMPTY_OPERATION_LIST, { type: 'list', bootId: 'boot-a', operations: [view({ rev: 3 }), view({ id: 'child', parentId: 'op-1' })] })
    expect(Object.keys(state.operations)).toEqual(['op-1'])
    state = mergeOperationList(state, { type: 'event', view: view({ rev: 2, title: 'stale' }) })
    expect(state.operations['op-1']?.rev).toBe(3)
    state = mergeOperationList(state, { type: 'list', bootId: 'boot-a', operations: [view({ rev: 1 })] })
    expect(state.operations['op-1']?.rev).toBe(3)
    state = mergeOperationList(state, { type: 'event', view: view({ id: 'op-2', bootId: 'boot-b' }) })
    expect(state).toEqual({ bootId: 'boot-b', operations: { 'op-2': view({ id: 'op-2', bootId: 'boot-b' }) } })
  })

  it('lists running work first and lets finished work age out', () => {
    const state = mergeOperationList(EMPTY_OPERATION_LIST, {
      type: 'list',
      bootId: 'boot-a',
      operations: [
        view({ id: 'done', status: 'succeeded', startedAt: iso(1_000), endedAt: iso(10_000) }),
        view({ id: 'old', status: 'failed', endedAt: iso(RECENTLY_FINISHED_MS + 1) }),
        view({ id: 'live' }),
      ],
    })
    expect(visibleOperations(state, NOW).map((op) => op.id)).toEqual(['live', 'done'])
    expect(trayLabel(visibleOperations(state, NOW))).toBe('Operations: 1 running')
    expect(trayLabel([view({ status: 'succeeded' })])).toBe('Operations: 1 just finished')
  })
})

describe('OperationsTrayView', () => {
  it('renders nothing when nothing is running or just finished', async () => {
    const { container } = await actRender(() => render(<OperationsTrayView operations={[]} />))
    expect(container.innerHTML).toBe('')
  })

  it('opens compact rows with Cancel and the operation link, and Cancel posts to the cancel route', async () => {
    const calls: string[] = []
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return json({ bootId: 'boot-a', status: 'cancelling' }, 202)
    }) as unknown as typeof fetch
    await actRender(() => render(
      <OperationsTrayView operations={[view({ href: '/team?agent=copywriter' }), view({ id: 'op-2', title: 'Reindex', cancellable: false, plan: { stages: [], pointOfNoReturn: 'start' } })]} />,
    ))
    const trigger = screen.getByRole('button', { name: 'Operations: 2 running' })
    await act(async () => { trigger.click() })

    const list = await screen.findByRole('list', { name: 'Operations' })
    const rows = within(list).getAllByRole('region')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Install Copywriter', 'Reindex'])
    expect(within(list).getByRole('link', { name: 'Open Install Copywriter' }).getAttribute('href')).toBe('/team?agent=copywriter')
    expect(within(rows[1]!).queryByRole('button', { name: 'Cancel' })).toBeNull()

    await act(async () => { within(rows[0]!).getByRole('button', { name: 'Cancel' }).click() })
    await waitUntil(() => calls.includes('POST /api/operations/op-1/cancel'), { label: 'cancel posted' })
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('says why a refused cancel did nothing', async () => {
    globalThis.fetch = mock(async () => json({ bootId: 'boot-a', status: 'not_cancellable' }, 409)) as unknown as typeof fetch
    await actRender(() => render(<OperationsTrayView operations={[view()]} />))
    await act(async () => { screen.getByRole('button', { name: 'Operations: 1 running' }).click() })
    await act(async () => { (await screen.findByRole('button', { name: 'Cancel' })).click() })
    await waitUntil(() => useToastStore.getState().toasts.length === 1, { label: 'refusal toast' })
    expect(String(useToastStore.getState().toasts[0]?.message)).toContain('past the point where it can be cancelled')
  })
})

describe('OperationsTray', () => {
  it('appears when an operation starts and follows its events', async () => {
    globalThis.fetch = mock(async () => json({ bootId: 'boot-a', operations: [] })) as unknown as typeof fetch
    await actRender(() => render(<OperationsTray />))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByTestId('operations-tray-button')).toBeNull()

    act(() => emitPluginEvent({ event: 'operation.updated', view: view({ rev: 2 }) }))
    expect(screen.getByRole('button', { name: 'Operations: 1 running' })).toBeTruthy()

    act(() => emitPluginEvent({ event: 'operation.updated', view: view({ rev: 3, status: 'succeeded', endedAt: new Date().toISOString() }) }))
    expect(screen.getByRole('button', { name: 'Operations: 1 just finished' })).toBeTruthy()
  })
})

describe('OperationsTray resilience', () => {
  it('ignores a malformed list answer instead of crashing the header', async () => {
    globalThis.fetch = mock(async () => json({})) as unknown as typeof fetch
    await actRender(() => render(<OperationsTray />))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByTestId('operations-tray-button')).toBeNull()
    act(() => emitPluginEvent({ event: 'operation.updated', view: view() }))
    expect(screen.getByRole('button', { name: 'Operations: 1 running' })).toBeTruthy()
  })
})
