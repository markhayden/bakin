import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { act, renderHook } from '@testing-library/react'
import { actRender } from '../rtl-settle'
import { usePluginEvent, emitPluginEvent } from '../../src/hooks/use-plugin-event'
const root = join(tmpdir(), `bakin-task-summary-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => root, getBakinPaths: () => ({ root }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => root, getBakinPaths: () => ({ root }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => root, getOpenClawPath: (...parts: string[]) => join(root, ...parts), resetOpenClawHome() {} }))
mock.module('@makinbakin/sdk/hooks', () => ({ usePluginEvent }))
import { useTaskSummary } from '../../plugins/tasks/hooks/use-task-summary'

function response(review: number) { return Response.json({ blocked: 0, review }) }
it('recovers missed changes on reconnect and retains state on failed reads', async () => {
  const fetcher = mock(async () => response(3))
  globalThis.fetch = fetcher as unknown as typeof fetch
  const view = await actRender(() => renderHook(useTaskSummary))
  expect(view.result.current.summary?.review).toBe(3)
  fetcher.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { emitPluginEvent({ event: 'bakin.reconcile' }) })
  expect(view.result.current.summary?.review).toBe(3)
  fetcher.mockResolvedValue(response(0))
  await act(async () => { emitPluginEvent({ event: 'bakin.reconcile' }) })
  expect(view.result.current.summary?.review).toBe(0)
  view.unmount()
})
it('never restores an obsolete review count when requests finish backwards', async () => {
  let resolveOld!: (value: Response) => void
  const old = new Promise<Response>((resolve) => { resolveOld = resolve })
  const fetcher = mock(() => old).mockResolvedValueOnce(response(3)).mockReturnValueOnce(old).mockResolvedValueOnce(response(0))
  globalThis.fetch = fetcher as unknown as typeof fetch
  const view = await actRender(() => renderHook(useTaskSummary))
  await act(async () => { emitPluginEvent({ event: 'taskboard' }) })
  await act(async () => { emitPluginEvent({ event: 'taskboard' }) })
  expect(view.result.current.summary?.review).toBe(0)
  await act(async () => { resolveOld(response(56)); await old })
  expect(view.result.current.summary?.review).toBe(0)
  view.unmount()
})
