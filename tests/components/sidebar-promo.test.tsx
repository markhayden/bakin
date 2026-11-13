import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { actRender } from '../rtl-settle'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-sidebar-promo-${crypto.randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@tanstack/react-router', () => ({
  Link: ({ to, hash, ...props }: ComponentProps<'a'> & { to: string; hash?: string }) => <a href={hash ? `${to}#${hash}` : to} {...props} />,
}))

import { SidebarPromo } from '../../packages/host/src/components/layout/sidebar-promo'

afterEach(cleanup)

describe('SidebarPromo', () => {
  it('uses the underlined link badge inside one navigation target', async () => {
    const onNavigate = mock(() => {})
    await actRender(() => render(<SidebarPromo collapsed={false} pathname="/workflows" onNavigate={onNavigate} />))
    const link = screen.getByRole('link', { name: /Make Bakin Yours/ })
    const badge = screen.getByText('Browse add-ons')
    expect(link.getAttribute('href')).toBe('/explore')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(link.contains(badge)).toBe(true)
    expect(badge.getAttribute('data-variant')).toBe('link')
    expect(badge.classList.contains('underline')).toBe(true)
    expect(badge.getAttribute('data-size')).toBe('sm')
    fireEvent.click(badge)
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('preserves active-page indication for add-on routes', async () => {
    await actRender(() => render(<SidebarPromo collapsed={false} pathname="/explore/plugins" />))
    expect(screen.getByRole('link', { name: /Make Bakin Yours/ }).getAttribute('aria-current')).toBe('page')
  })

  it('keeps the collapsed navigation target labelled without the badge', async () => {
    await actRender(() => render(<SidebarPromo collapsed pathname="/workflows" />))
    expect(screen.getByRole('link', { name: 'Make Bakin Yours' }).getAttribute('href')).toBe('/explore')
    expect(screen.queryByText('Browse add-ons')).toBeNull()
  })

  it('with suggestions it counts them and leads to where Home lists them', async () => {
    await actRender(() => render(<SidebarPromo collapsed={false} pathname="/tasks" count={3} />))
    const link = screen.getByRole('link', { name: /Make Bakin Yours/ })
    expect(link.getAttribute('href')).toBe('/#do-more')
    expect(link.textContent).toContain('3 suggestions for getting more out of Bakin.')
    expect(screen.getByText('See what you can add')).toBeTruthy()
    expect(screen.queryByText('Browse add-ons')).toBeNull()
  })

  it('one suggestion is "1 suggestion", and none is the plain Explore card', async () => {
    const view = await actRender(() => render(<SidebarPromo collapsed={false} pathname="/tasks" count={1} />))
    expect(screen.getByRole('link').textContent).toContain('1 suggestion for getting more out of Bakin.')
    view.unmount()
    await actRender(() => render(<SidebarPromo collapsed={false} pathname="/tasks" count={0} />))
    expect(screen.getByRole('link').getAttribute('href')).toBe('/explore')
    expect(screen.getByText('Browse add-ons')).toBeTruthy()
  })

  it('collapsed, the count is in the name a screen reader hears', async () => {
    await actRender(() => render(<SidebarPromo collapsed pathname="/tasks" count={2} />))
    const link = screen.getByRole('link', { name: 'Make Bakin Yours, 2 suggestions' })
    expect(link.getAttribute('href')).toBe('/#do-more')
  })
})
