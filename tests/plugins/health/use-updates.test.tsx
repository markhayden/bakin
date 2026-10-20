// @vitest-environment jsdom

import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import '../../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-use-updates-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts), resetOpenClawHome: () => {} }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { emitPluginEvent, usePluginEvent } from '../../../src/hooks/use-plugin-event'
// Captured BEFORE the module is mocked (live namespace binding): the SDK's render helpers stay real under the narrow mock.
import * as realSdkHooks from '@makinbakin/sdk/hooks'
mock.module('@makinbakin/sdk/hooks', () => ({ ...realSdkHooks, usePluginEvent }))

import { checkUpdates, isApplicableUpdate, skipUpdate, useUpdateApply, useUpdatesResource } from '../../../plugins/health/hooks/use-updates'
import { operationStarted } from '../../helpers/operation-fetch'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const PLUGIN: UpdateRecord = {
  id: 'plugin:notes', group: 'available', subject: { kind: 'plugin', id: 'notes', label: 'notes' }, outcome: 'update-available',
  installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '1.1.0', display: '1.1.0' }, reason: 'newer-version',
  source: { kind: 'artifact-index', endpoint: 'x' }, observedAt: '2026-10-20T11:00:00.000Z', fingerprint: 'fp',
  action: { kind: 'operation', start: { route: '/api/updates/plugin%3Anotes/apply' }, impact: ['download'] },
}

describe('useUpdatesResource (#1007 D7.7)', () => {
  it('reads /api/updates once, validates it, and re-reads on updates.changed', async () => {
    let reads = 0
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/updates') {
        reads += 1
        return json({ bootId: 'b', generatedAt: '2026-10-20T11:00:00.000Z', running: false, records: reads === 1 ? [] : [PLUGIN] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch

    const { result } = renderHook(() => useUpdatesResource())
    await waitFor(() => expect(result.current.data?.records).toEqual([]))
    act(() => emitPluginEvent({ event: 'updates.changed', ids: ['plugin:notes'] }))
    await waitFor(() => expect(result.current.data?.records).toHaveLength(1))
    expect(reads).toBe(2)
  })

  it('an invalid or refused engine answer is an error, never an empty list', async () => {
    globalThis.fetch = mock(async () => json({ records: 'nope' })) as unknown as typeof fetch
    const { result } = renderHook(() => useUpdatesResource())
    await waitFor(() => expect(result.current.error).toBe('Updates returned an invalid response'))
    expect(result.current.data).toBeNull()
  })
})

describe('engine actions', () => {
  it('checkUpdates waits for the pass, scoped to one kind when asked, and surfaces the server message', async () => {
    const urls: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      expect(init?.method).toBe('POST')
      if (url.endsWith('source=search-engine')) return json({ error: 'unknown_source', message: 'nope' }, 400)
      return json({ bootId: 'b', ids: ['plugin:notes'], coalesced: true, records: [PLUGIN] })
    }) as unknown as typeof fetch
    expect(await checkUpdates()).toEqual([PLUGIN])
    expect(await checkUpdates('plugin')).toEqual([PLUGIN])
    await expect(checkUpdates('search-engine')).rejects.toThrow('nope')
    expect(urls).toEqual(['/api/updates/check?wait=1', '/api/updates/check?wait=1&source=plugin', '/api/updates/check?wait=1&source=search-engine'])
  })

  it('skipUpdate returns the engine\'s record and refuses an invalid one', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/updates/plugin%3Anotes/skip') return json({ bootId: 'b', record: { ...PLUGIN, skipped: { version: '1.1.0' } } })
      if (url === '/api/updates/bakin%3Abakin/skip') return json({ bootId: 'b', error: 'nothing_to_skip', message: '"bakin:bakin" has nothing to skip — no available identity' }, 409)
      return json({ bootId: 'b', record: { id: 1 } })
    }) as unknown as typeof fetch
    expect((await skipUpdate('plugin:notes')).skipped).toEqual({ version: '1.1.0' })
    await expect(skipUpdate('bakin:bakin')).rejects.toThrow('nothing to skip')
    await expect(skipUpdate('plugin:x')).rejects.toThrow('Skip returned an invalid record')
  })

  it('isApplicableUpdate: available, not skipped, operation-backed', () => {
    expect(isApplicableUpdate(PLUGIN)).toBe(true)
    expect(isApplicableUpdate({ ...PLUGIN, skipped: { version: '1.1.0' } })).toBe(false)
    expect(isApplicableUpdate({ ...PLUGIN, action: { kind: 'manual', pointer: 'x' } })).toBe(false)
    expect(isApplicableUpdate({ ...PLUGIN, outcome: 'blocked' })).toBe(false)
  })
})

describe('useUpdateApply settle paths', () => {
  it('a non-Bakin operation whose outcome went missing (server restarted) ends outcome-unknown and re-reads', async () => {
    let settled = 0
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/updates/plugin%3Anotes/apply-preview') return json({ bootId: 'boot-test', preview: { id: PLUGIN.id, record: PLUGIN, action: PLUGIN.action } })
      if (url === '/api/updates/plugin%3Anotes/apply' && init?.method === 'POST') return operationStarted('op-gone')
      // The read answers from a NEW boot: the operation is gone with the old process.
      if (url.startsWith('/api/operations/op-gone')) return json({ bootId: 'boot-other', error: 'not_found' }, 404)
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const { result } = renderHook(() => useUpdateApply(() => { settled += 1 }))
    await act(async () => { await result.current.open(PLUGIN) })
    expect(result.current.state.status).toBe('ready')
    await act(async () => { await result.current.confirm() })
    await waitFor(() => expect(result.current.state.status).toBe('outcome-unknown'))
    expect(result.current.state.status === 'outcome-unknown' && result.current.state.message).toContain('Check for updates to confirm the result')
    expect(settled).toBe(1)
    act(() => result.current.close())
    expect(result.current.state.status).toBe('idle')
  })

  it('a preview failure is a failed state with the server\'s reason, and nothing starts', async () => {
    globalThis.fetch = mock(async () => json({ bootId: 'b', error: 'multiple_covering_approvals', message: '2 pending Health approvals cover "plugin:notes" — decide them on the Health page first.' }, 409)) as unknown as typeof fetch
    const { result } = renderHook(() => useUpdateApply())
    await act(async () => { await result.current.open(PLUGIN) })
    expect(result.current.state).toMatchObject({ status: 'failed', error: '2 pending Health approvals cover "plugin:notes" — decide them on the Health page first.' })
    await act(async () => { await result.current.confirm() })
    expect(result.current.state.status).toBe('failed')
  })
})
