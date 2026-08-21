// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

// Pure client-component test — the isolation mocks are belt-and-braces per
// the repo's test rules.
const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-catalog-card-unused',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (agentId: string) => agentId ? { name: 'Pixel', headshot: '/agents/pixel.png' } : null,
  useAgentColor: () => '#ff4f91',
  useAgentDisplayName: (agentId: string) => agentId ? 'Pixel' : null,
}))

mock.module('@makinbakin/sdk/patterns', () => ({
  AgentAvatar: ({ agent }: { agent: { id: string } }) => <span data-testid={`avatar-${agent.id}`} />,
  StatusBadge: ({
    children,
    icon: _Icon,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & { icon?: unknown }) => <span {...props}>{children}</span>,
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
  runtimes: ['*'],
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
  it('renders a compact identity, category, and description', () => {
    render(<CatalogCard entry={entry()} onSelect={mock()} />)
    expect(screen.getByText('Pixel')).toBeTruthy()
    expect(screen.getByText('Creative')).toBeTruthy()
    expect(screen.getByText('Image artist agent.')).toBeTruthy()
    expect(screen.queryByText(/Best for:/)).toBeNull()
  })

  it('shows the Built in badge for builtin entries', () => {
    render(<CatalogCard entry={entry({ builtin: true, installed: true })} onSelect={mock()} />)
    expect(screen.getByText('Built in')).toBeTruthy()
  })

  it('invokes onSelect through the whole-card overlay control', () => {
    const onSelect = mock()
    const item = entry()
    render(<CatalogCard entry={item} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'View Pixel details' }))
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

  it('uninstalled entries with a catalog iconUrl compose the icon avatar, emoji as its fallback', () => {
    render(<CatalogCard entry={entry({ iconUrl: 'https://example.com/pixel.png' })} onSelect={mock()} />)
    // The kit Avatar owns the image/fallback swap and only commits the <img>
    // once the browser reports it loaded — a load event jsdom never fires — so
    // the assertable contract here is that the iconUrl branch is taken and the
    // emoji is demoted to the fallback rather than being the whole visual.
    const avatar = screen.getByTestId('icon-agent-pixel')
    expect(avatar.getAttribute('data-slot')).toBe('avatar')
    expect(avatar.textContent).toContain('🎨')
  })

  it('entries with no iconUrl render an emoji avatar with no icon identity', () => {
    render(<CatalogCard entry={entry()} onSelect={mock()} />)
    expect(screen.queryByTestId('icon-agent-pixel')).toBeNull()
    expect(screen.getByText('🎨')).toBeTruthy()
  })

  it('the local headshot wins over a catalog iconUrl once installed', () => {
    render(<CatalogCard entry={entry({ installed: true, iconUrl: 'https://example.com/pixel.png' })} onSelect={mock()} />)
    expect(screen.getByTestId('avatar-pixel')).toBeTruthy()
    expect(screen.queryByTestId('icon-agent-pixel')).toBeNull()
  })

  it('badges and gates install for runtime-incompatible entries', () => {
    const onInstall = mock()
    render(<CatalogCard
      entry={entry({ kind: 'skill-pack', id: 'oc-only', runtimes: ['openclaw'], installed: false, builtin: false })}
      onSelect={mock()}
      onInstall={onInstall}
      activeAdapter="pi"
    />)
    expect(screen.getByTestId('card-incompatible-oc-only').textContent).toContain('Not for pi')
    expect(screen.queryByTestId('card-install-skill-pack-oc-only')).toBeNull()
  })

  it('universal runtimes entries stay installable with no compat badge', () => {
    const onInstall = mock()
    render(<CatalogCard
      entry={entry({ kind: 'skill-pack', id: 'cap', runtimes: ['*'], installed: false, builtin: false })}
      onSelect={mock()}
      onInstall={onInstall}
      activeAdapter="pi"
    />)
    expect(screen.queryByTestId('card-incompatible-cap')).toBeNull()
    expect(screen.getByTestId('card-install-skill-pack-cap')).toBeTruthy()
  })
})
