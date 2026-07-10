// @vitest-environment jsdom

/**
 * Tests for @makinbakin/sdk/slots — the client-side plugin slot system.
 *
 * Verifies registration accumulation, Slot rendering, ordering, prop pass-
 * through, and the empty-registration fallback. The registry is a browser-
 * global Map keyed on slot name, so between-test isolation uses
 * `clearSlotsOwnedBy` with a test-scoped owner id.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
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

const TEST_OWNER = '__test_slots'

function Caption({ text }: { text: string }) {
  return <span data-testid="caption">{text}</span>
}

function Alt({ text }: { text: string }) {
  return <strong data-testid="alt">ALT:{text}</strong>
}

afterEach(() => {
  clearSlotsOwnedBy(TEST_OWNER)
  cleanup()
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
