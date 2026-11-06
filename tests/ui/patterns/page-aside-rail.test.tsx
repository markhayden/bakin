// @vitest-environment jsdom
/**
 * PageAside collapsible rail — width presets and edge (projects revamp D10,
 * approved extension 2026-10-25): `width="conversation"` (360px) and
 * `side="end"` for a trailing docked conversation; `resizable` (2026-11-05,
 * Mark: "i should be able to drag this chat window") puts the kit grab bar on
 * the rail's page-facing edge with a persisted width.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { PageAside, type PageAsideResizable, type PageAsideSide, type PageAsideWidth } from '@makinbakin/sdk/patterns'

afterEach(() => cleanup())

const rail = (props: { width?: PageAsideWidth; side?: PageAsideSide; resizable?: PageAsideResizable } = {}, collapsed = false) => render(
  <PageAside label="Project conversation" collapsible={{ collapsed, onCollapsedChange: () => {} }} {...props}>
    <p>Thread</p>
  </PageAside>,
)

describe('PageAside collapsible rail', () => {
  it('defaults to a start-edge session rail', () => {
    rail()
    const aside = screen.getByRole('complementary', { name: 'Project conversation' })
    expect(aside.className).toContain('w-[var(--bakin-layout-size-rail-session)]')
    expect(aside.className).toContain('border-r')
    expect(aside.hasAttribute('data-side')).toBe(false)
  })

  it('width="conversation" is the 360px conversation rail', () => {
    rail({ width: 'conversation' })
    expect(screen.getByRole('complementary', { name: 'Project conversation' }).className).toContain('w-[var(--bakin-layout-size-rail-conversation)]')
  })

  it('side="end" moves the edge border to the leading side and marks the rail', () => {
    rail({ width: 'conversation', side: 'end' })
    const aside = screen.getByRole('complementary', { name: 'Project conversation' })
    expect(aside.getAttribute('data-side')).toBe('end')
    expect(aside.className).toContain('border-l')
    expect(aside.className).not.toContain('border-r')
  })

  it('an end rail collapses to the kit strip with the same expand control', () => {
    rail({ width: 'conversation', side: 'end' }, true)
    const expand = screen.getByRole('button', { name: 'Expand project conversation' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('complementary', { name: 'Project conversation' }).className).toContain('w-[var(--bakin-layout-size-rail-strip)]')
  })

  describe('resizable', () => {
    const KEY = 'bakin-aside-width:test-dock'
    beforeEach(() => localStorage.removeItem(KEY))

    const separator = () => screen.getByRole('separator', { name: 'Resize project conversation' })

    it('an end rail gets a leading-edge grab bar at the preset width, driven by a CSS variable', () => {
      rail({ width: 'conversation', side: 'end', resizable: { storageKey: 'test-dock' } })
      const aside = screen.getByRole('complementary', { name: 'Project conversation' })
      expect(separator().getAttribute('aria-orientation')).toBe('vertical')
      expect(separator().getAttribute('aria-valuenow')).toBe('360')
      expect(aside.style.getPropertyValue('--bakin-aside-width')).toBe('360px')
      expect(aside.className).toContain('w-[var(--bakin-aside-width)]')
      expect(aside.className).not.toContain('w-[var(--bakin-layout-size-rail-conversation)]')
    })

    it('before the row is measured, the CSS cap alone keeps a persisted width from crushing the page', () => {
      localStorage.setItem(KEY, '720')
      rail({ width: 'conversation', side: 'end', resizable: { storageKey: 'test-dock' } })
      const aside = screen.getByRole('complementary', { name: 'Project conversation' })
      expect(aside.className).toContain('max-w-[50%]')
      expect(separator().getAttribute('aria-valuenow')).toBe('720')
    })

    it('once measured, the effective maximum is half the row: the handle and aria track the rendered width', async () => {
      // jsdom has no layout; a ResizeObserver stand-in reports the row at 600px.
      const original = globalThis.ResizeObserver
      let observed: Element | null = null
      let notify: ((width: number) => void) | null = null
      globalThis.ResizeObserver = class {
        constructor(private readonly cb: (entries: { target: Element; contentRect: { width: number } }[]) => void) {}
        observe(el: Element) { observed = el; notify = (width) => this.cb([{ target: el, contentRect: { width } }]) }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
      try {
        localStorage.setItem(KEY, '720')
        rail({ width: 'conversation', side: 'end', resizable: { storageKey: 'test-dock', minWidth: 280 } })
        const aside = screen.getByRole('complementary', { name: 'Project conversation' })
        expect(observed as Element | null).toBe(aside.parentElement)
        await act(async () => { notify!(600) })
        expect(separator().getAttribute('aria-valuemax')).toBe('300')
        expect(separator().getAttribute('aria-valuenow')).toBe('300')
        expect(aside.style.getPropertyValue('--bakin-aside-width')).toBe('300px')
        // Measured: the bounds govern alone; the pre-measurement CSS cap is gone.
        expect(aside.className).not.toContain('max-w-[50%]')
        // The preference is not rewritten by measurement — a wider screen gets it back.
        expect(localStorage.getItem(KEY)).toBe('720')
        // Interaction starts from the rendered width: one step in shrinks visibly.
        await act(async () => { fireEvent.keyDown(separator(), { key: 'ArrowRight' }) })
        expect(separator().getAttribute('aria-valuenow')).toBe('284')
        expect(localStorage.getItem(KEY)).toBe('284')
        // A wider row raises the ceiling again, up to the configured maximum.
        await act(async () => { notify!(2000) })
        expect(separator().getAttribute('aria-valuemax')).toBe('720')
        // A row too narrow for twice the minimum: the minimum yields too, so the
        // rendered width, the CSS variable and the accessible values still agree.
        await act(async () => { notify!(500) })
        expect(separator().getAttribute('aria-valuemin')).toBe('250')
        expect(separator().getAttribute('aria-valuemax')).toBe('250')
        expect(separator().getAttribute('aria-valuenow')).toBe('250')
        expect(aside.style.getPropertyValue('--bakin-aside-width')).toBe('250px')
      } finally {
        globalThis.ResizeObserver = original
      }
    })

    it('the preset defaults are the rail tokens in px', () => {
      const tokens = JSON.parse(readFileSync('packages/ui/tokens/reference.tokens.json', 'utf-8')) as { reference: { size: Record<string, { $value: { value: number; unit: string } }> } }
      for (const [width, token] of [['nav', 'railNav'], ['session', 'railSession'], ['conversation', 'railConversation']] as const) {
        cleanup()
        rail({ width, side: 'end', resizable: { storageKey: 'test-dock' } })
        const { value, unit } = tokens.reference.size[token]!.$value
        expect(unit).toBe('rem')
        expect(separator().getAttribute('aria-valuenow')).toBe(String(value * 16))
      }
    })

    it('ArrowLeft grows an end rail and persists the width under the storage key', async () => {
      rail({ width: 'conversation', side: 'end', resizable: { storageKey: 'test-dock' } })
      await act(async () => { fireEvent.keyDown(separator(), { key: 'ArrowLeft' }) })
      expect(separator().getAttribute('aria-valuenow')).toBe('376')
      expect(screen.getByRole('complementary', { name: 'Project conversation' }).style.getPropertyValue('--bakin-aside-width')).toBe('376px')
      expect(localStorage.getItem(KEY)).toBe('376')
    })

    it('a start rail resizes from its trailing edge: ArrowRight grows it', async () => {
      rail({ width: 'session', side: 'start', resizable: { storageKey: 'test-dock' } })
      await act(async () => { fireEvent.keyDown(separator(), { key: 'ArrowRight' }) })
      expect(separator().getAttribute('aria-valuenow')).toBe('304')
      await act(async () => { fireEvent.keyDown(separator(), { key: 'ArrowLeft' }) })
      expect(separator().getAttribute('aria-valuenow')).toBe('288')
    })

    it('a persisted width wins over the preset and is clamped to the bounds', () => {
      localStorage.setItem(KEY, '5000')
      rail({ width: 'conversation', side: 'end', resizable: { storageKey: 'test-dock' } })
      expect(separator().getAttribute('aria-valuenow')).toBe(separator().getAttribute('aria-valuemax'))
      expect(separator().getAttribute('aria-valuemin')).toBe('200')
      expect(separator().getAttribute('aria-valuemax')).toBe('720')
    })

    it('custom bounds are honoured', () => {
      rail({ width: 'conversation', side: 'end', resizable: { storageKey: 'test-dock', minWidth: 300, maxWidth: 500 } })
      expect(separator().getAttribute('aria-valuemin')).toBe('300')
      expect(separator().getAttribute('aria-valuemax')).toBe('500')
    })

    it('a collapsed rail has no grab bar and keeps the strip width', () => {
      rail({ width: 'conversation', side: 'end', resizable: { storageKey: 'test-dock' } }, true)
      expect(screen.queryByRole('separator', { name: 'Resize project conversation' })).toBeNull()
      expect(screen.getByRole('complementary', { name: 'Project conversation' }).className).toContain('w-[var(--bakin-layout-size-rail-strip)]')
    })

    it('without resizable there is no grab bar and the token width class stays', () => {
      rail({ width: 'conversation', side: 'end' })
      expect(screen.queryByRole('separator')).toBeNull()
      expect(screen.getByRole('complementary', { name: 'Project conversation' }).className).toContain('w-[var(--bakin-layout-size-rail-conversation)]')
    })
  })
})
