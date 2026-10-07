import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { waitUntil, settleFor } from '../../helpers/wait'

const testDir = join(tmpdir(), `bakin-test-channel-reruns-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))

import { wireChannelHealthReruns } from '@bakin/health/lib/channel-readiness-reruns'

describe('wireChannelHealthReruns', () => {
  it('reruns once per debounce window for state or routing changes, never for a plain refresh, and stops on teardown', async () => {
    let listener: ((change: { stateChanged: boolean; routingChanged: boolean }) => void) | null = null
    let unsubscribed = false
    const runs: number[] = []
    const stop = wireChannelHealthReruns({
      subscribe: (cb) => { listener = cb; return () => { unsubscribed = true } },
      run: async () => { runs.push(Date.now()) },
      checkIds: ['health.delivery-discord'],
      debounceMs: 20,
    })
    listener!({ stateChanged: false, routingChanged: false })
    await settleFor(40, 'a refresh with nothing changed must not rerun')
    expect(runs).toHaveLength(0)

    listener!({ stateChanged: true, routingChanged: false })
    listener!({ stateChanged: true, routingChanged: false })
    listener!({ stateChanged: false, routingChanged: true })
    await waitUntil(() => runs.length === 1, { label: 'one debounced rerun' })
    await settleFor(40, 'the burst must collapse into one run')
    expect(runs).toHaveLength(1)

    stop()
    expect(unsubscribed).toBe(true)
    listener!({ stateChanged: true, routingChanged: false })
    await settleFor(40, 'no rerun after teardown')
    expect(runs).toHaveLength(1)
  })

  it('routes a failing run to onError instead of throwing', async () => {
    let listener: ((change: { stateChanged: boolean; routingChanged: boolean }) => void) | null = null
    const errors: unknown[] = []
    const stop = wireChannelHealthReruns({
      subscribe: (cb) => { listener = cb; return () => {} },
      run: async () => { throw new Error('boom') },
      checkIds: [],
      debounceMs: 5,
      onError: (err) => { errors.push(err) },
    })
    listener!({ stateChanged: true, routingChanged: false })
    await waitUntil(() => errors.length === 1, { label: 'error routed' })
    stop()
  })
})
