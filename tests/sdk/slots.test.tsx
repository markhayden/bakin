// @vitest-environment jsdom

/**
 * Tests for @bakin/sdk/slots — the client-side plugin slot system.
 *
 * Verifies registration accumulation, Slot rendering, ordering, prop pass-
 * through, and the empty-registration fallback. The registry is a browser-
 * global Map keyed on slot name, so between-test isolation requires
 * __clearSlot() on every name used in a test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// Defensive isolation per CLAUDE.md — this test is pure in-memory React but
// the lint hook requires content-dir mocks on every test to guarantee no
// accidental write path can reach ~/.bakin/.
vi.mock('../../src/core/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-sdk-slots-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
vi.mock('../../packages/core/src/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-sdk-slots-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import { Slot, registerSlot, getSlotEntries, __clearSlot } from '@bakin/sdk/slots'

function Caption({ text }: { text: string }) {
  return <span data-testid="caption">{text}</span>
}

function Alt({ text }: { text: string }) {
  return <strong data-testid="alt">ALT:{text}</strong>
}

afterEach(() => {
  __clearSlot('test.caption')
  __clearSlot('test.empty')
  cleanup()
})

describe('@bakin/sdk/slots — registry', () => {
  it('starts empty for an unknown name', () => {
    expect(getSlotEntries('test.empty')).toHaveLength(0)
  })

  it('accumulates registrations and sorts by order', () => {
    registerSlot('test.caption', Caption, 50)
    registerSlot('test.caption', Alt, 10)
    const entries = getSlotEntries('test.caption')
    expect(entries).toHaveLength(2)
    expect(entries[0].component).toBe(Alt)      // order 10 renders first
    expect(entries[1].component).toBe(Caption)  // order 50 renders second
  })

  it('defaults order to 100', () => {
    registerSlot('test.caption', Caption)
    expect(getSlotEntries('test.caption')[0].order).toBe(100)
  })
})

describe('@bakin/sdk/slots — <Slot>', () => {
  it('renders nothing when nothing is registered', () => {
    const { container } = render(<Slot name="test.empty" text="hi" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders every registered entry with the passed props', () => {
    registerSlot('test.caption', Caption)
    render(<Slot name="test.caption" text="hello" />)
    expect(screen.getByTestId('caption').textContent).toBe('hello')
  })

  it('renders multiple entries in ascending order', () => {
    registerSlot('test.caption', Caption, 50)
    registerSlot('test.caption', Alt, 10)
    render(<Slot name="test.caption" text="x" />)
    const alt = screen.getByTestId('alt')
    const cap = screen.getByTestId('caption')
    // DOM order matches render order — Alt (order 10) appears before Caption (order 50)
    expect(alt.compareDocumentPosition(cap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('passes through arbitrary prop names untouched', () => {
    function Echo(props: Record<string, unknown>) {
      return <span data-testid="echo">{JSON.stringify(props)}</span>
    }
    registerSlot('test.caption', Echo)
    render(<Slot name="test.caption" foo="bar" count={42} />)
    const body = screen.getByTestId('echo').textContent!
    expect(body).toContain('"foo":"bar"')
    expect(body).toContain('"count":42')
  })
})
