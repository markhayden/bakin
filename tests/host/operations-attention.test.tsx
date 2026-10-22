// @vitest-environment jsdom
/**
 * Operations attention (#895 D14, D17): toast AND OS notification once per
 * transition — finished/failed once per operation, stuck once per stage —
 * only for operations a person started (web, CLI, Discord), never for
 * children, system work, cancellations or while on the operation's page.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-host-operations-attn-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const notifications: Array<{ title: string; body: string; url?: string }> = []
// Captured BEFORE the module is mocked (live namespace binding): the SDK's internal entry re-exports the host verbs from this module, so the mock spreads the real one.
import * as realBrowserNotify from '../../packages/sdk/src/internal/browser-notify'
mock.module('../../packages/sdk/src/internal/browser-notify', () => ({
  ...realBrowserNotify,
  sendBrowserNotification: (title: string, body: string, url?: string) => { notifications.push({ title, body, url }) },
}))

import { act, render } from '@testing-library/react'
import '../rtl-settle'
import { emitPluginEvent, useToastStore } from '@makinbakin/sdk/hooks'
import type { OperationView } from '@makinbakin/sdk/types'
import { nextOperationAttention } from '../../packages/host/src/components/attention/operation-attention'
import { OperationsAttentionProvider } from '../../packages/host/src/components/attention/operations-attention-provider'

const NOW = Date.parse('2026-10-16T12:00:00.000Z')
const iso = (msAgo: number, from = NOW) => new Date(from - msAgo).toISOString()
const elsewhere = { pathname: '/health', search: '' }

function view(over: Partial<OperationView> = {}, from = NOW): OperationView {
  return {
    id: 'op-1',
    children: [],
    rev: 1,
    bootId: 'boot-a',
    kind: 'install',
    owner: 'core',
    origin: 'cli',
    title: 'Install Copywriter',
    href: '/team?agent=copywriter',
    fingerprint: 'install:copywriter',
    resources: ['install-state'],
    status: 'running',
    plan: { stages: [{ id: 'fetch', kind: 'downloading', label: 'Download archive' }, { id: 'build', kind: 'building', label: 'Build' }], pointOfNoReturn: null },
    stages: [
      { id: 'fetch', kind: 'downloading', label: 'Download archive', status: 'active', startedAt: iso(60_000, from) },
      { id: 'build', kind: 'building', label: 'Build', status: 'pending' },
    ],
    cancellable: true,
    startedAt: iso(60_000, from),
    lastProgressAt: iso(0, from),
    lastLivenessAt: iso(0, from),
    log: [],
    ...over,
  }
}

describe('operation attention (pure rules)', () => {
  it('announces finish and failure once per operation, never a cancellation', () => {
    const done = nextOperationAttention(view({ status: 'succeeded', outcome: { code: 'ok', message: 'Installed.' } }), undefined, NOW, elsewhere)
    expect(done.notice).toEqual({ kind: 'finished', title: 'Install Copywriter finished', body: 'Installed.', url: '/team?agent=copywriter' })
    expect(nextOperationAttention(view({ status: 'succeeded', rev: 9 }), done.memo, NOW, elsewhere).notice).toBeNull()
    expect(nextOperationAttention(view({ status: 'failed' }), undefined, NOW, elsewhere).notice?.kind).toBe('failed')
    expect(nextOperationAttention(view({ status: 'cancelled' }), undefined, NOW, elsewhere).notice).toBeNull()
  })

  it('announces stuck once per stage', () => {
    const stuckFetch = view({ lastProgressAt: iso(31_000) })
    const first = nextOperationAttention(stuckFetch, undefined, NOW, elsewhere)
    expect(first.notice).toEqual({ kind: 'stuck', title: 'Install Copywriter looks stuck', body: 'Download archive has made no progress for 31s.', url: '/team?agent=copywriter' })
    expect(nextOperationAttention({ ...stuckFetch, rev: 2 }, first.memo, NOW, elsewhere).notice).toBeNull()

    const stuckBuild = view({
      lastProgressAt: iso(121_000),
      stages: [{ id: 'fetch', kind: 'downloading', label: 'Download archive', status: 'done' }, { id: 'build', kind: 'building', label: 'Build', status: 'active' }],
    })
    expect(nextOperationAttention(stuckBuild, first.memo, NOW, elsewhere).notice?.body).toBe('Build has made no progress for 2m.')
    // Quiet (not yet stuck) says nothing.
    expect(nextOperationAttention(view({ lastProgressAt: iso(15_000) }), undefined, NOW, elsewhere).notice).toBeNull()
  })

  it('keys on origin, skips children, and stays quiet on the operation page', () => {
    for (const origin of ['web', 'cli', 'discord'] as const) {
      expect(nextOperationAttention(view({ origin, status: 'failed' }), undefined, NOW, elsewhere).notice).not.toBeNull()
    }
    const system = nextOperationAttention(view({ origin: 'system', status: 'failed' }), undefined, NOW, elsewhere)
    expect(system.notice).toBeNull()
    expect(system.memo.finished).toBe(true)
    expect(nextOperationAttention(view({ parentId: 'p', status: 'failed' }), undefined, NOW, elsewhere).notice).toBeNull()
    expect(nextOperationAttention(view({ status: 'failed' }), undefined, NOW, { pathname: '/team', search: '?agent=copywriter' }).notice).toBeNull()
    expect(nextOperationAttention(view({ status: 'failed' }), undefined, NOW, { pathname: '/team', search: '?agent=other' }).notice).not.toBeNull()
  })
})

describe('OperationsAttentionProvider', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    notifications.length = 0
  })

  it('toasts and sends an OS notification once per transition', async () => {
    await act(async () => { render(<OperationsAttentionProvider />) })
    const now = Date.now()
    act(() => {
      emitPluginEvent({ event: 'operation.updated', view: view({ rev: 1 }, now) })
      emitPluginEvent({ event: 'operation.updated', view: view({ rev: 2, lastProgressAt: iso(40_000, now) }, now) })
      emitPluginEvent({ event: 'operation.updated', view: view({ rev: 3, lastProgressAt: iso(45_000, now) }, now) })
    })
    expect(useToastStore.getState().toasts.map((t) => t.type)).toEqual(['info'])
    expect(notifications.map((n) => n.title)).toEqual(['Install Copywriter looks stuck'])

    act(() => {
      emitPluginEvent({ event: 'operation.updated', view: view({ rev: 4, status: 'failed', outcome: { code: 'x', message: 'Checksum mismatch.' } }, now) })
      // A replayed milestone after reconnect announces nothing new.
      emitPluginEvent({ event: 'operation.updated', view: view({ rev: 4, status: 'failed' }, now) })
    })
    expect(useToastStore.getState().toasts.map((t) => t.type)).toEqual(['info', 'error'])
    expect(notifications).toHaveLength(2)
    expect(notifications[1]).toEqual({ title: 'Install Copywriter failed', body: 'Checksum mismatch.', url: '/team?agent=copywriter' })
  })
})
