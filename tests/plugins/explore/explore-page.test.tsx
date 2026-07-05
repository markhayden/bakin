// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

// Pure client-component test — the isolation mocks are belt-and-braces per
// the repo's test rules.
const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-explore-page-unused',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

let fixtureEntries: unknown[] = []

mock.module('@makinbakin/sdk/hooks', () => {
  const { useState } = require('react') as typeof import('react')
  return {
    useJsonFetch: () => ({
      data: { ok: true, updatedAt: 'now', remoteUpdatedAt: null, entries: fixtureEntries },
      loading: false,
      error: null,
      refresh: mock(),
    }),
    useQueryState: (_key: string, initial = '') => {
      const [value, setValue] = useState(initial)
      return [value, setValue, setValue]
    },
    useQueryArrayState: (_key: string) => {
      const [value, setValue] = useState<string[]>([])
      return [value, setValue]
    },
  }
})

mock.module('@makinbakin/sdk/ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

mock.module('@makinbakin/sdk/components', () => ({
  PluginHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
  ErrorBanner: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  UnderlineTabs: ({ tabs, onValueChange }: { tabs: Array<{ id: string; label: string }>; onValueChange: (id: string) => void }) => (
    <div>
      {tabs.map((tab) => (
        <button key={tab.id} data-testid={`tab-${tab.id}`} onClick={() => onValueChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
  FacetFilter: ({ options, onChange }: { options: Array<{ value: string; label: string }>; onChange: (v: string[]) => void }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} data-testid={`facet-${option.value}`} onClick={() => onChange([option.value])}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  BakinDrawer: ({ open, children, title }: { open: boolean; children: ReactNode; title?: ReactNode }) =>
    open ? <aside data-testid="drawer">{title}{children}</aside> : null,
}))

import { ExplorePage } from '../../../plugins/explore/components/explore-page'

const baseEntry = {
  tags: [],
  ref: null,
  trust: 'official',
  builtin: false,
  dependencies: [],
  defaultSelected: false,
  installed: false,
  updateAvailable: null,
  installedVersion: null,
}

const AGENTS = [
  { ...baseEntry, id: 'pixel', kind: 'agent', name: 'Pixel', description: 'Images', category: 'Creative', useCases: ['Make images'], source: 'github:x#agents/pixel' },
  { ...baseEntry, id: 'jessica', kind: 'agent', name: 'Jessica', description: 'Research', category: 'Research', useCases: ['Dig deep'], source: 'github:x#agents/jessica' },
]
const PLUGINS = [
  { ...baseEntry, id: 'messaging', kind: 'plugin', name: 'Messaging', description: 'Content', category: 'Content', useCases: ['Plan posts'], source: 'github:x#plugins/messaging' },
  { ...baseEntry, id: 'team', kind: 'plugin', name: 'Team', description: 'Roster', category: 'Platform', useCases: ['Meet the team'], builtin: true, installed: true },
]
const PACK = { ...baseEntry, id: 'writing', kind: 'lesson-pack', name: 'Writing', description: 'Lessons', category: 'Content', useCases: ['Write better'], source: 'github:x#packs/writing' }

afterEach(cleanup)

describe('ExplorePage', () => {
  it('renders agent cards on the default tab only', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    expect(screen.getByText('Pixel')).toBeTruthy()
    expect(screen.queryByText('Messaging')).toBeNull()
  })

  it('hides the Packs tab when the catalog has no pack entries', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    expect(screen.queryByTestId('tab-packs')).toBeNull()
  })

  it('shows the Packs tab when pack entries exist', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS, PACK]
    render(<ExplorePage />)
    expect(screen.getByTestId('tab-packs')).toBeTruthy()
  })

  it('switches tabs and renders builtin badge for core plugins', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    fireEvent.click(screen.getByTestId('tab-plugins'))
    expect(screen.getByText('Messaging')).toBeTruthy()
    expect(screen.getByText('Built in')).toBeTruthy()
  })

  it('filters by category', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    fireEvent.click(screen.getByTestId('facet-Research'))
    expect(screen.getByText('Jessica')).toBeTruthy()
    expect(screen.queryByText('Pixel')).toBeNull()
  })

  it('opens the detail drawer with use cases on card click', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    fireEvent.click(screen.getByTestId('catalog-card-agent-pixel'))
    expect(screen.getByTestId('drawer')).toBeTruthy()
    expect(screen.getByText('Make images')).toBeTruthy()
  })
})
