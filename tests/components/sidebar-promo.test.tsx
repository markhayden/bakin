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
  Link: ({ to, ...props }: ComponentProps<'a'> & { to: string }) => <a href={to} {...props} />,
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
})
