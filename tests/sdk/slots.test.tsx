// @vitest-environment jsdom

/**
 * Tests for @makinbakin/sdk/slots — the client-side plugin slot system.
 *
 * Verifies registration accumulation, Slot rendering, ordering, prop pass-
 * through, and the empty-registration fallback. The registry is a browser-
 * global Map keyed on slot name, so between-test isolation uses
 * `clearSlotsOwnedBy` with a test-scoped owner id.
 */
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import '../rtl-settle'

// Defensive isolation per CLAUDE.md — this test is pure in-memory React but
// the lint hook requires content-dir mocks on every test to guarantee no
// accidental write path can reach ~/.bakin/.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-sdk-slots-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-sdk-slots-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import { Slot, registerSlot, getSlotEntries, clearSlotsOwnedBy } from '@makinbakin/sdk/slots'
import { usePluginOwnership } from '@makinbakin/sdk/internal'

const TEST_OWNER = '__test_slots'
const SECOND_TEST_OWNER = '__test_slots_second'

function Caption({ text }: { text: string }) {
  return <span data-testid="caption">{text}</span>
}

function Alt({ text }: { text: string }) {
  return <strong data-testid="alt">ALT:{text}</strong>
}

afterEach(() => {
  clearSlotsOwnedBy(TEST_OWNER)
  clearSlotsOwnedBy(SECOND_TEST_OWNER)
})

describe('@makinbakin/sdk/slots — registry', () => {
  it('starts empty for an unknown name', () => {
    expect(getSlotEntries('test.empty')).toHaveLength(0)
  })

  it('accumulates registrations and sorts by order', () => {
    registerSlot('test.caption', Caption, 50, TEST_OWNER)
    registerSlot('test.caption', Alt, 10, TEST_OWNER)
    const entries = getSlotEntries('test.caption')
    expect(entries).toHaveLength(2)
    expect(entries[0].component).toBe(Alt as any)      // order 10 renders first
    expect(entries[1].component).toBe(Caption as any)  // order 50 renders second
  })

  it('defaults order to 100', () => {
    registerSlot('test.caption', Caption, undefined, TEST_OWNER)
    expect(getSlotEntries('test.caption')[0].order).toBe(100)
  })
})

describe('@makinbakin/sdk/slots — <Slot>', () => {
  it('renders nothing when nothing is registered', () => {
    const { container } = render(<Slot name="test.empty" text="hi" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders every registered entry with the passed props', () => {
    registerSlot('test.caption', Caption, 100, TEST_OWNER)
    render(<Slot name="test.caption" text="hello" />)
    expect(screen.getByTestId('caption').textContent).toBe('hello')
  })

  it('renders multiple entries in ascending order', () => {
    registerSlot('test.caption', Caption, 50, TEST_OWNER)
    registerSlot('test.caption', Alt, 10, TEST_OWNER)
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
    registerSlot('test.caption', Echo, 100, TEST_OWNER)
    render(<Slot name="test.caption" foo="bar" count={42} />)
    const body = screen.getByTestId('echo').textContent!
    expect(body).toContain('"foo":"bar"')
    expect(body).toContain('"count":42')
  })

  it('wraps every owned contribution in an independent plugin root', () => {
    registerSlot('test.owned', Caption, 10, TEST_OWNER)
    registerSlot('test.owned', Alt, 20, SECOND_TEST_OWNER)

    const { container } = render(<Slot name="test.owned" text="owned" />)
    const roots = container.querySelectorAll('[data-bakin-plugin]')

    expect(roots).toHaveLength(2)
    expect(roots[0].getAttribute('data-bakin-plugin')).toBe(TEST_OWNER)
    expect(roots[0].querySelector('[data-testid="caption"]')).not.toBeNull()
    expect(roots[1].getAttribute('data-bakin-plugin')).toBe(SECOND_TEST_OWNER)
    expect(roots[1].querySelector('[data-testid="alt"]')).not.toBeNull()
  })

  it('gives a nested contribution its own nearest plugin root', () => {
    function NestedSlot() {
      return (
        <section data-testid="outer-contribution">
          <Slot name="test.nested-inner" text="nested" />
        </section>
      )
    }

    registerSlot('test.nested-outer', NestedSlot, 10, TEST_OWNER)
    registerSlot('test.nested-inner', Caption, 10, SECOND_TEST_OWNER)

    render(<Slot name="test.nested-outer" />)

    const outer = screen.getByTestId('outer-contribution')
    const inner = screen.getByTestId('caption')
    expect(outer.closest('[data-bakin-plugin]')?.getAttribute('data-bakin-plugin')).toBe(TEST_OWNER)
    expect(inner.closest('[data-bakin-plugin]')?.getAttribute('data-bakin-plugin')).toBe(SECOND_TEST_OWNER)
  })

  it('provides the nearest plugin identity to ownership-aware SDK internals', () => {
    function OwnershipProbe() {
      return <span data-testid="ownership-probe">{usePluginOwnership() ?? 'none'}</span>
    }

    registerSlot('test.ownership-context', OwnershipProbe, 10, TEST_OWNER)

    render(<Slot name="test.ownership-context" />)

    expect(screen.getByTestId('ownership-probe').textContent).toBe(TEST_OWNER)
  })

  it('preserves contribution identity when another owned entry registers', () => {
    let mounts = 0
    function StatefulContribution() {
      const [instance] = useState(() => ++mounts)
      return <span data-testid="stateful-contribution">{instance}</span>
    }

    registerSlot('test.identity', StatefulContribution, 10, TEST_OWNER)
    const { rerender } = render(<Slot name="test.identity" text="first" />)

    registerSlot('test.identity', Alt, 20, SECOND_TEST_OWNER)
    rerender(<Slot name="test.identity" text="second" />)

    expect(screen.getByTestId('stateful-contribution').textContent).toBe('1')
    expect(mounts).toBe(1)
  })

  it('keeps a crashing contribution fallback inside its plugin root', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    function BrokenContribution(): never {
      throw new Error('expected slot ownership test crash')
    }

    try {
      registerSlot('test.owned-error', BrokenContribution, 10, TEST_OWNER)

      render(<Slot name="test.owned-error" />)

      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain(`Plugin "${TEST_OWNER}" failed to render this section.`)
      expect(alert.closest('[data-bakin-plugin]')?.getAttribute('data-bakin-plugin')).toBe(TEST_OWNER)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('retains a stable root for an owned background contribution that renders null', () => {
    function BackgroundContribution() {
      return null
    }

    registerSlot('test.background', BackgroundContribution, 10, TEST_OWNER)

    const { container } = render(<Slot name="test.background" />)

    expect(container.firstElementChild?.getAttribute('data-bakin-plugin')).toBe(TEST_OWNER)
    expect(container.firstElementChild?.childElementCount).toBe(0)
  })

  it('removes an ownership root when its contribution is cleared', () => {
    registerSlot('test.ownership-cleanup', Caption, 10, TEST_OWNER)
    const { container, rerender } = render(<Slot name="test.ownership-cleanup" text="cleanup" />)

    expect(container.querySelector(`[data-bakin-plugin="${TEST_OWNER}"]`)).not.toBeNull()

    clearSlotsOwnedBy(TEST_OWNER)
    rerender(<Slot name="test.ownership-cleanup" text="cleanup" />)

    expect(container.querySelector('[data-bakin-plugin]')).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it('preserves the DOM shape of ownerless compatibility registrations', () => {
    registerSlot('test.ownerless', Caption)

    const { container } = render(<Slot name="test.ownerless" text="legacy" />)

    expect(container.querySelector('[data-bakin-plugin]')).toBeNull()
    expect(container.firstElementChild?.getAttribute('data-testid')).toBe('caption')
  })
})

describe('@makinbakin/sdk/slots — clearSlotsOwnedBy', () => {
  it('removes only entries owned by the given plugin', () => {
    registerSlot('test.caption', Caption, 50, 'plugin-a')
    registerSlot('test.caption', Alt, 60, 'plugin-b')
    clearSlotsOwnedBy('plugin-a')
    const entries = getSlotEntries('test.caption')
    expect(entries).toHaveLength(1)
    expect(entries[0].component).toBe(Alt as any)
    // Cleanup for next tests
    clearSlotsOwnedBy('plugin-b')
  })

  it('leaves unowned entries in place', () => {
    registerSlot('test.caption', Caption, 50)           // no owner
    registerSlot('test.caption', Alt, 60, 'plugin-a')
    clearSlotsOwnedBy('plugin-a')
    const entries = getSlotEntries('test.caption')
    expect(entries).toHaveLength(1)
    expect(entries[0].component).toBe(Caption as any)
    // No test-owner cleanup needed; no TEST_OWNER registrations
  })
})
