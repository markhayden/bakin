import { afterEach, expect, it, mock } from 'bun:test'
import { act, render } from '@testing-library/react'
import { actRender } from '../../rtl-settle'
import { usePluginEvent, emitPluginEvent } from '../../../src/hooks/use-plugin-event'
import { usePluginJsonFetch } from '../../../src/hooks/use-json-fetch'

let badge: { count?: number; tone?: string } | null = null
mock.module('@makinbakin/sdk/hooks', () => ({
  usePluginEvent, usePluginJsonFetch,
  useNavBadge: (_plugin: string, _nav: string, value: typeof badge) => { badge = value },
}))
import { AssetsBadgeProvider } from '../../../plugins/assets/components/assets-badge-provider'
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; badge = null })
const response = (count: number) => Response.json({ count })

it('seeds from the server snapshot and retains it through a failed recovery read', async () => {
  const fetcher = mock(async () => response(3))
  globalThis.fetch = fetcher as unknown as typeof fetch
  await actRender(() => render(<AssetsBadgeProvider />))
  expect(badge).toEqual({ count: 3, tone: 'info' })
  fetcher.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { emitPluginEvent({ event: 'bakin.reconcile' }) })
  expect(badge).toEqual({ count: 3, tone: 'info' })
  fetcher.mockResolvedValue(response(0))
  await act(async () => { emitPluginEvent({ event: 'bakin.reconcile' }) })
  expect(badge).toBeNull()
})

it('uses the snapshot after mutation and cannot restore a stale asset count', async () => {
  let resolveOld!: (response: Response) => void
  const old = new Promise<Response>((resolve) => { resolveOld = resolve })
  const fetcher = mock(() => old).mockResolvedValueOnce(response(3)).mockReturnValueOnce(old).mockResolvedValueOnce(response(0))
  globalThis.fetch = fetcher as unknown as typeof fetch
  await actRender(() => render(<AssetsBadgeProvider />))
  await act(async () => { emitPluginEvent({ event: 'asset.unmanaged', count: 56 }) })
  await act(async () => { emitPluginEvent({ event: 'asset.unmanaged', count: 0 }) })
  expect(badge).toBeNull()
  await act(async () => { resolveOld(response(56)); await old })
  expect(badge).toBeNull()
})
