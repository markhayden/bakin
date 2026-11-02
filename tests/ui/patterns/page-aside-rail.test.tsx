// @vitest-environment jsdom
/**
 * PageAside collapsible rail — width presets and edge (projects revamp D10,
 * approved extension 2026-10-25): `width="conversation"` (360px) and
 * `side="end"` for a trailing docked conversation.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { PageAside, type PageAsideSide, type PageAsideWidth } from '@makinbakin/sdk/patterns'

afterEach(() => cleanup())

const rail = (props: { width?: PageAsideWidth; side?: PageAsideSide } = {}, collapsed = false) => render(
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
})
