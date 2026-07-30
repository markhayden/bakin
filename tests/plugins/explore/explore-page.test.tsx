// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { createContext, useContext, type ReactNode } from 'react'

// Pure client-component test — the isolation mocks are belt-and-braces per
// the repo's test rules.
const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-explore-page-unused',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

let fixtureEntries: unknown[] = []

const toastMock = mock()

let cachedData: unknown = null
let cachedFor: unknown = null

mock.module('@makinbakin/sdk/hooks', () => {
  return {
    toast: toastMock,
    useAgent: (agentId: string) => agentId ? { name: 'Pixel', headshot: '/agents/pixel.png' } : null,
    useAgentColor: () => '#ff4f91',
    useAgentDisplayName: (agentId: string) => agentId ? 'Pixel' : null,
    // data must be referentially stable across renders (like the real
    // hook's state) — the page clears probe overrides when data CHANGES.
    useJsonFetch: () => {
      if (cachedFor !== fixtureEntries) {
        cachedFor = fixtureEntries
        cachedData = { ok: true, updatedAt: 'now', remoteUpdatedAt: null, entries: fixtureEntries }
      }
      return { data: cachedData, loading: false, error: null, refresh: mock() }
    },
  }
})

mock.module('@makinbakin/sdk/navigation', () => {
  const { useState } = require('react') as typeof import('react')
  return {
    PluginLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
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

mock.module('@makinbakin/sdk/layout', () => ({
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const TabsMockContext = createContext<{ onValueChange?: (value: unknown) => void }>({})

mock.module('@makinbakin/sdk/ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Tabs: ({ children, onValueChange }: { children: ReactNode; value?: string; onValueChange?: (value: unknown) => void }) => (
    <TabsMockContext.Provider value={{ onValueChange }}>
      <div>{children}</div>
    </TabsMockContext.Provider>
  ),
  TabsList: ({ children }: { children: ReactNode; variant?: string; activateOnFocus?: boolean }) => (
    <div role="tablist">{children}</div>
  ),
  TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => {
    const { onValueChange } = useContext(TabsMockContext)
    return (
      <button data-testid={`tab-${value}`} onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    )
  },
  Drawer: ({
    open,
    children,
    title,
    actions,
  }: {
    open: boolean
    children: ReactNode
    title?: ReactNode
    actions?: ReactNode
  }) => open ? <aside data-testid="drawer">{title}{actions}{children}</aside> : null,
  DrawerSection: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <section><h3>{title}</h3>{children}</section>
  ),
  Button: ({
    children,
    size,
    variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => (
    <button data-size={size} data-variant={variant} {...props}>{children}</button>
  ),
  Banner: ({
    title,
    description,
    action,
  }: {
    title: string
    description?: string
    action?: ReactNode
  }) => <div role="alert">{title}{description}{action}</div>,
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
  CardFooter: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 {...props}>{children}</h3>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  SystemState: ({
    kind,
    title,
    description,
    action,
    preview,
  }: {
    kind: string
    title: string
    description?: string
    action?: ReactNode
    preview?: ReactNode
  }) => (
    <div
      data-testid={kind === 'no-results' || kind === 'initial-empty' ? 'empty-state' : 'system-state'}
      role={kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined}
    >
      {title}{description}{action}{preview}
    </div>
  ),
}))

mock.module('@makinbakin/sdk/patterns', () => ({
  AgentAvatar: ({ agent }: { agent: { id: string } }) => <span data-testid={`avatar-${agent.id}`} />,
  StatusBadge: ({
    children,
    icon: _Icon,
    size,
    tone,
    variant,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & {
    icon?: unknown
    size?: string
    tone?: string
    variant?: string
  }) => (
    <span data-size={size} data-tone={tone} data-variant={variant} {...props}>{children}</span>
  ),
  PageHeader: ({
    title,
    description,
    meta,
    controls,
    actions,
  }: {
    title: string
    description?: string
    meta?: ReactNode
    controls?: ReactNode
    actions?: ReactNode
  }) => (
    <div>
      <h1>{title}</h1>
      {description}
      {meta}
      {controls}
      {actions}
    </div>
  ),
  SearchInput: ({
    label,
    value,
    onValueChange,
    placeholder,
  }: {
    label: string
    value: string
    onValueChange: (value: string) => void
    placeholder?: string
  }) => (
    <input
      aria-label={label}
      data-testid="explore-search"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
  ListPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListPageControls: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <div>{children}{actions}</div>,
  ListPageContent: ({
    children,
    feedback,
    state,
  }: {
    children: ReactNode
    feedback?: ReactNode
    state?: ReactNode
  }) => <main>{feedback}{state ?? children}</main>,
  FacetFilter: ({ options, onChange }: { options: Array<{ value: string; label: string }>; onChange: (v: string[]) => void }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} data-testid={`facet-${option.value}`} onClick={() => onChange([option.value])}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}))

import { ExplorePage } from '../../../plugins/explore/components/explore-page'

const baseEntry = {
  tags: [],
  screenshots: [],
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
const SKILL_PACK = { ...baseEntry, id: 'ops-skills', kind: 'skill-pack', name: 'Ops Skills', description: 'Skills', category: 'Operations', useCases: ['Automate ops'], source: 'github:x#packs/ops-skills' }


describe('ExplorePage', () => {
  it('renders agent cards on the default tab only', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    expect(screen.getByText('Pixel')).toBeTruthy()
    expect(screen.queryByText('Messaging')).toBeNull()
  })

  it('alphabetizes entries within each tab', () => {
    // Fixture order is Pixel then Jessica — display must be A→Z.
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    const names = screen.getAllByTestId(/^catalog-card-agent-/).map((card) => card.getAttribute('data-testid'))
    expect(names).toEqual(['catalog-card-agent-jessica', 'catalog-card-agent-pixel'])
  })

  it('search filters the active tab across name, description, tags, and use cases', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    // Filtering reads the draft synchronously; only the URL write debounces.
    fireEvent.change(screen.getByTestId('explore-search'), { target: { value: 'dig deep' } })
    expect(screen.queryByText('Pixel')).toBeNull()
    expect(screen.getByText('Jessica')).toBeTruthy()
  })

  it('search with no matches shows an honest empty state naming the query', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    fireEvent.change(screen.getByTestId('explore-search'), { target: { value: 'zebra' } })
    expect(screen.getByTestId('empty-state').textContent).toContain('No catalog items match')
  })

  it('hides the Packs tab when the catalog has no pack entries', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    expect(screen.queryByTestId('tab-packs')).toBeNull()
  })

  it('always shows the Lessons tab with an educational empty state', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    fireEvent.click(screen.getByTestId('tab-lessons'))
    expect(screen.getByTestId('empty-state').textContent).toContain('Lesson packs are coming')
  })

  it('renders the canonical page header and a per-tab intro', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    expect(screen.getByRole('heading', { name: 'Explore' })).toBeTruthy()
    expect(screen.getByTestId('tab-intro').textContent).toContain('Hire your team')
    fireEvent.click(screen.getByTestId('tab-plugins'))
    expect(screen.getByTestId('tab-intro').textContent).toContain('Extend the platform')
  })

  it('lesson packs land on the Lessons tab', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS, PACK]
    render(<ExplorePage />)
    // A lesson-pack alone does not surface the skill/workflow Packs tab.
    expect(screen.queryByTestId('tab-packs')).toBeNull()
    fireEvent.click(screen.getByTestId('tab-lessons'))
    expect(screen.getByText('Writing')).toBeTruthy()
  })

  it('shows the Packs tab when skill/workflow pack entries exist', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS, SKILL_PACK]
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

  it('a category selected on one tab never empties another tab', () => {
    // Regression: tab switching used to reset categories via a second URL
    // write that clobbered the tab change from stale params. Now stale
    // category selections are simply inert on tabs where they don't exist.
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    fireEvent.click(screen.getByTestId('facet-Research'))
    expect(screen.queryByText('Pixel')).toBeNull()
    fireEvent.click(screen.getByTestId('tab-plugins'))
    // 'Research' doesn't exist on the plugins tab — all plugin cards visible.
    expect(screen.getByText('Messaging')).toBeTruthy()
    expect(screen.getByText('Team')).toBeTruthy()
  })

  it('opens the detail drawer with use cases on card click', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    fireEvent.click(screen.getByTestId('catalog-card-agent-pixel'))
    expect(screen.getByTestId('drawer')).toBeTruthy()
    expect(screen.getByText('Make images')).toBeTruthy()
  })

  it('shows the drawer Install button only for available entries', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    // Available agent → Install present
    fireEvent.click(screen.getByTestId('catalog-card-agent-pixel'))
    const install = screen.getByTestId('drawer-install')
    const official = screen.getByText('Official')
    expect(install.getAttribute('data-size')).toBe('xs')
    expect(install.getAttribute('data-variant')).toBe('primary')
    expect(official.getAttribute('data-tone')).toBe('accent')
    expect(official.getAttribute('data-variant')).toBe('solid')
  })

  it('never shows Install for builtin entries', () => {
    fixtureEntries = [...AGENTS, ...PLUGINS]
    render(<ExplorePage />)
    fireEvent.click(screen.getByTestId('tab-plugins'))
    fireEvent.click(screen.getByTestId('catalog-card-plugin-team'))
    expect(screen.getByTestId('drawer')).toBeTruthy()
    expect(screen.queryByTestId('drawer-install')).toBeNull()
  })

  it('shows a compact disabled Installed action for already-installed entries', () => {
    fixtureEntries = [{ ...AGENTS[0], installed: true, installedVersion: '1.0.0' }]
    render(<ExplorePage />)
    fireEvent.click(screen.getByTestId('catalog-card-agent-pixel'))
    expect(screen.getByTestId('drawer')).toBeTruthy()
    expect(screen.queryByTestId('drawer-install')).toBeNull()
    const installed = screen.getByTestId('drawer-installed') as HTMLButtonElement
    expect(installed.disabled).toBe(true)
    expect(installed.getAttribute('data-size')).toBe('xs')
    expect(installed.getAttribute('data-variant')).toBe('primary')
  })
})

describe('ExplorePage update/refresh actions', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('Check for updates fetches ?check=1 and overrides displayed entries', async () => {
    fixtureEntries = [...AGENTS]
    const probed = [{ ...AGENTS[0], installed: true, updateAvailable: true, installedVersion: '1.0.0' }]
    const fetchMock = mock((url: string) => {
      expect(url).toBe('/api/plugins/explore/catalog?check=1')
      return Promise.resolve(new Response(JSON.stringify({
        ok: true, updatedAt: 'now', remoteUpdatedAt: null, entries: probed,
      }), { headers: { 'Content-Type': 'application/json' } }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(<ExplorePage />)
    expect(screen.queryByText('Update available')).toBeNull()
    toastMock.mockClear()
    fireEvent.click(screen.getByTestId('check-updates'))
    await waitFor(() => expect(screen.getByText('Update available')).toBeTruthy())
    // Result feedback is a toast naming the updatable entries
    expect(String(toastMock.mock.calls[0][0])).toContain('1 update available: Pixel')
  })

  it('check with everything current toasts an up-to-date confirmation', async () => {
    fixtureEntries = [...AGENTS]
    const fetchMock = mock(() => Promise.resolve(new Response(JSON.stringify({
      ok: true, updatedAt: 'now', remoteUpdatedAt: null,
      entries: [{ ...AGENTS[0], installed: true, updateAvailable: false }],
    }), { headers: { 'Content-Type': 'application/json' } })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(<ExplorePage />)
    toastMock.mockClear()
    fireEvent.click(screen.getByTestId('check-updates'))
    await waitFor(() => expect(toastMock).toHaveBeenCalled())
    expect(String(toastMock.mock.calls[0][0])).toContain('Everything is up to date')
  })

  it('Refresh catalog POSTs and surfaces failures as an error banner', async () => {
    fixtureEntries = [...AGENTS]
    const fetchMock = mock((url: string, init?: RequestInit) => {
      expect(url).toBe('/api/plugins/explore/catalog/refresh')
      expect(init?.method).toBe('POST')
      return Promise.resolve(new Response(JSON.stringify({
        ok: false, reason: 'no-remote-catalog', error: 'The official bits repo has no catalog.json yet.',
      }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(<ExplorePage />)
    fireEvent.click(screen.getByTestId('refresh-catalog'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('no catalog.json yet'))
    // Catalog still rendered from the base fetch — failure is non-destructive
    expect(screen.getByText('Pixel')).toBeTruthy()
  })
})
