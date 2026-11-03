// @vitest-environment jsdom
/**
 * AppSidebar (issue 966b review): the group that owns the current path opens
 * when the nav registry introduces it after mount (a manifest/plugin load),
 * not only on navigation — and other groups' toggles are left alone.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { actRender } from '../rtl-settle'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const testDir = join(tmpdir(), `bakin-test-sidebar-registry-${crypto.randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) })
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
import { registerPlugin, unregisterPlugin } from '../../packages/sdk/src/register'
import { SidebarContext } from '@/context/sidebar-context'
import { AppSidebar } from '../../packages/host/src/components/layout/app-sidebar'

afterEach(() => { cleanup(); unregisterPlugin('late-plugin') })

describe('AppSidebar — registry changes', () => {
  it('opens the group owning the current path when the registry adds it after mount', async () => {
    window.history.pushState(null, '', '/late/child')
    await actRender(() => render(
      <SidebarContext value={{ collapsed: false, toggle: () => {} }}>
        <AppSidebar />
      </SidebarContext>,
    ))
    expect(screen.queryByRole('button', { name: /Late group/ })).toBeNull()
    await act(async () => {
      registerPlugin({
        id: 'late-plugin',
        navItems: [{ id: 'late-group', label: 'Late group', href: '/late', children: [{ id: 'late-child', label: 'Late child', href: '/late/child' }] }],
      } as Parameters<typeof registerPlugin>[0])
    })
    expect(screen.getByRole('button', { name: /Late group/ }).getAttribute('aria-expanded')).toBe('true')
  })
})
