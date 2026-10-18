/**
 * useUnsavedChangesGuard route-blocker settlement: every navigation the guard
 * blocks is settled exactly once — a superseded one stays blocked, one still
 * waiting when the surface goes clean or unmounts goes through, and an older
 * blocker's continuation never closes a newer blocker's prompt.
 */
import { StrictMode, useEffect } from 'react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup } from '@testing-library/react'
import { actRender, settleReact } from '../rtl-settle'

type Blocker = (args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => Promise<boolean>
let blockers: Blocker[] = []
// ONE router instance, like TanStack's: a fresh object per render would
// re-run the guard's blocker effect (and its cleanup) on every render.
const router = {
  navigate: () => {},
  history: { block: ({ blockerFn }: { blockerFn: Blocker }) => { blockers.push(blockerFn); return () => { blockers = blockers.filter((b) => b !== blockerFn) } } },
  parseLocation: (location: unknown) => location,
}
let currentRouter = router
mock.module('@tanstack/react-router', () => ({
  ...require('../shims/tanstack-router'),
  useRouter: () => currentRouter,
}))

import { render, renderHook, screen } from '@testing-library/react'
import { useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'

const nav = (to: string) => ({ currentLocation: { pathname: '/here' }, nextLocation: { pathname: to } })

/** Track a blocker promise's outcome without awaiting it. */
function track(promise: Promise<boolean>): { value: boolean | 'pending' } {
  const box: { value: boolean | 'pending' } = { value: 'pending' }
  void promise.then((value) => { box.value = value })
  return box
}

async function renderGuard(dirty = true) {
  const hook = await actRender(() => renderHook(({ hasUnsavedChanges }) => useUnsavedChangesGuard({
    hasUnsavedChanges,
    saving: false,
    onCancel: () => {},
    onSaveAndExit: async () => true,
    onDiscardAndExit: () => {},
  }), { initialProps: { hasUnsavedChanges: dirty } }))
  return hook
}

afterEach(async () => {
  await settleReact()
  cleanup()
  blockers = []
  currentRouter = router
})

describe('useUnsavedChangesGuard route blockers', () => {
  it('a second navigation settles the first as blocked; the decision is about the second', async () => {
    const { result } = await renderGuard()
    let first = track(Promise.resolve(false))
    let second = track(Promise.resolve(false))
    await act(async () => {
      first = track(blockers[0]!(nav('/a')))
      second = track(blockers[0]!(nav('/b')))
    })
    await settleReact()
    expect(first.value).toBe(true)
    expect(second.value).toBe('pending')
    await act(async () => { result.current.reset() })
    await settleReact()
    expect(second.value).toBe(true)
  })

  it('re-subscribing while still dirty (router identity change) never lets a pending navigation through', async () => {
    const { result, rerender } = await renderGuard()
    let pending = track(Promise.resolve(false))
    await act(async () => { pending = track(blockers[0]!(nav('/a'))) })
    currentRouter = { ...router }
    await act(async () => { rerender({ hasUnsavedChanges: true }) })
    await settleReact()
    expect(pending.value).toBe('pending')
    expect(blockers).toHaveLength(1) // re-registered once, the old one removed
    await act(async () => { result.current.reset() })
    await settleReact()
    expect(pending.value).toBe(true)
  })

  it('a navigation still waiting when the surface goes clean goes through', async () => {
    const { rerender } = await renderGuard()
    let pending = track(Promise.resolve(true))
    await act(async () => { pending = track(blockers[0]!(nav('/a'))) })
    await act(async () => { rerender({ hasUnsavedChanges: false }) })
    await settleReact()
    expect(pending.value).toBe(false)
    expect(blockers).toHaveLength(0)
  })

  it('StrictMode replay of a live dirty guard never lets a waiting navigation through', async () => {
    const outcome: { value: boolean | 'pending' } = { value: 'pending' }
    let started = false
    function Surface() {
      const guard = useUnsavedChangesGuard({ hasUnsavedChanges: true, saving: false, onCancel: () => {}, onSaveAndExit: async () => true, onDiscardAndExit: () => {} })
      // A navigation that starts during the first mount, before the replay.
      useEffect(() => {
        if (started) return
        started = true
        void blockers[0]!(nav('/a')).then((value) => { outcome.value = value })
      }, [])
      return <>{guard.dialog}</>
    }
    await actRender(() => render(<StrictMode><Surface /></StrictMode>))
    await settleReact()
    expect(outcome.value).toBe('pending')
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeDefined()
  })

  it('a navigation still waiting when the guard unmounts goes through', async () => {
    const { unmount } = await renderGuard()
    let pending = track(Promise.resolve(true))
    await act(async () => { pending = track(blockers[0]!(nav('/a'))) })
    await act(async () => { unmount() })
    await settleReact()
    expect(pending.value).toBe(false)
  })

  it('an older blocker settling never closes a newer blocker\'s prompt', async () => {
    // Render the guard's dialog so the prompt's visibility is asserted, not
    // just the promises.
    let guard!: ReturnType<typeof useUnsavedChangesGuard>
    function Surface() {
      guard = useUnsavedChangesGuard({ hasUnsavedChanges: true, saving: false, onCancel: () => {}, onSaveAndExit: async () => true, onDiscardAndExit: () => {} })
      return <>{guard.dialog}</>
    }
    await actRender(() => render(<Surface />))
    let first = track(Promise.resolve(false))
    let second = track(Promise.resolve(false))
    await act(async () => {
      first = track(blockers[0]!(nav('/a')))
      guard.reset()
      second = track(blockers[0]!(nav('/b')))
    })
    await settleReact()
    expect(first.value).toBe(true)
    expect(second.value).toBe('pending')
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeDefined()
    await act(async () => { guard.reset() })
    await settleReact()
    expect(second.value).toBe(true)
  })
})
