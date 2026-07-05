// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

// Pure client-component test — the isolation mocks are belt-and-braces per
// the repo's test rules.
const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-catalog-card-unused',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('@makinbakin/sdk/ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

mock.module('@makinbakin/sdk/components', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid={`avatar-${agentId}`} />,
}))

import { CatalogCard, entryStatusBadge } from '../../../plugins/explore/components/catalog-card'
import type { ExploreCatalogEntry } from '../../../plugins/explore/types'

const entry = (over: Partial<ExploreCatalogEntry> = {}): ExploreCatalogEntry => ({
  id: 'pixel',
  kind: 'agent',
  name: 'Pixel',
  emoji: '🎨',
  description: 'Image artist agent.',
  category: 'Creative',
  tags: [],
  useCases: ['Generate on-brand social images'],
  source: 'github:markhayden/bakin-bits-official#agents/pixel',
  ref: null,
  trust: 'official',
  builtin: false,
  dependencies: [],
  defaultSelected: false,
  screenshots: [],
  installed: false,
  updateAvailable: null,
  installedVersion: null,
  ...over,
})

afterEach(cleanup)

describe('entryStatusBadge', () => {
  it('prioritizes builtin over everything', () => {
    expect(entryStatusBadge(entry({ builtin: true, installed: true, updateAvailable: true }))?.label).toBe('Built in')
  })
  it('prefers update-available over installed', () => {
    expect(entryStatusBadge(entry({ installed: true, updateAvailable: true }))?.label).toBe('Update available')
  })
  it('shows installed when current', () => {
    expect(entryStatusBadge(entry({ installed: true, updateAvailable: false }))?.label).toBe('Installed')
  })
  it('shows nothing for available entries', () => {
    expect(entryStatusBadge(entry())).toBeNull()
  })
})

describe('CatalogCard', () => {
  it('renders name, category, and first use case', () => {
    render(<CatalogCard entry={entry()} onSelect={mock()} />)
    expect(screen.getByText('Pixel')).toBeTruthy()
    expect(screen.getByText('Creative')).toBeTruthy()
    expect(screen.getByText(/Generate on-brand social images/)).toBeTruthy()
  })

  it('shows the Built in badge for builtin entries', () => {
    render(<CatalogCard entry={entry({ builtin: true, installed: true })} onSelect={mock()} />)
    expect(screen.getByText('Built in')).toBeTruthy()
  })

  it('invokes onSelect with the entry on click', () => {
    const onSelect = mock()
    const item = entry()
    render(<CatalogCard entry={item} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('catalog-card-agent-pixel'))
    expect(onSelect).toHaveBeenCalledWith(item)
  })

  it('shows the installed version bottom-right when known', () => {
    render(<CatalogCard entry={entry({ installed: true, installedVersion: '1.2.0' })} onSelect={mock()} />)
    expect(screen.getByTestId('card-version').textContent).toBe('v1.2.0')
  })

  it('available entries get an on-card Install button that does not open the drawer', () => {
    const onSelect = mock()
    const onInstall = mock()
    const item = entry()
    render(<CatalogCard entry={item} onSelect={onSelect} onInstall={onInstall} />)
    fireEvent.click(screen.getByTestId('card-install-agent-pixel'))
    expect(onInstall).toHaveBeenCalledWith(item)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('installed and builtin entries never show the on-card Install button', () => {
    render(<CatalogCard entry={entry({ installed: true })} onSelect={mock()} onInstall={mock()} />)
    expect(screen.queryByTestId('card-install-agent-pixel')).toBeNull()
    cleanup()
    render(<CatalogCard entry={entry({ builtin: true, installed: true, source: undefined })} onSelect={mock()} onInstall={mock()} />)
    expect(screen.queryByTestId('card-install-agent-pixel')).toBeNull()
  })

  it('installed agents render the real headshot avatar instead of the emoji', () => {
    render(<CatalogCard entry={entry({ installed: true })} onSelect={mock()} />)
    expect(screen.getByTestId('avatar-pixel')).toBeTruthy()
    expect(screen.queryByText('🎨')).toBeNull()
  })

  it('uninstalled agents keep the emoji', () => {
    render(<CatalogCard entry={entry()} onSelect={mock()} />)
    expect(screen.queryByTestId('avatar-pixel')).toBeNull()
    expect(screen.getByText('🎨')).toBeTruthy()
  })
})
