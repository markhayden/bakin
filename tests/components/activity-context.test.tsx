// @vitest-environment jsdom
/**
 * ActivityProvider (#966b): the open state is seeded from localStorage in the
 * state initializer — no post-mount effect, so the first frame is already the
 * remembered one — and every toggle is written back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'
import { ActivityProvider, useActivityContext } from '@/context/activity-context'

function Probe() {
  const { open, toggle } = useActivityContext()
  return <button type="button" onClick={toggle}>{open ? 'open' : 'closed'}</button>
}

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => store.clear(),
    },
  })
})
afterEach(() => { store.clear() })

describe('ActivityProvider', () => {
  it('renders the remembered state on the first frame and persists toggles', async () => {
    store.set('bakin-activity-log-open', 'false')
    render(<ActivityProvider><Probe /></ActivityProvider>)
    expect(screen.getByRole('button').textContent).toBe('closed')
    await act(async () => { fireEvent.click(screen.getByRole('button')) })
    expect(screen.getByRole('button').textContent).toBe('open')
    expect(store.get('bakin-activity-log-open')).toBe('true')
  })
})
