// @vitest-environment jsdom

/**
 * Calendar local filter smoke tests.
 *
 * Per spec §5.1d, the content calendar is intentionally NOT backed by
 * Antfly — only brainstorm sessions are. C14 wired a plain client-side
 * substring filter over `title | brief | draft.caption | draft.agentNotes`
 * (case-insensitive). These tests verify the filter, the empty-state
 * behavior, and assert that this component does NOT import useSearch.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-messaging-calfilter-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

// ---------------------------------------------------------------------------
// useQueryState — back with React.useState so updates are reactive
// ---------------------------------------------------------------------------
mock.module('@/hooks/use-query-state', () => {
  const { useState } = require('react') as typeof import('react')
  return {
    useQueryState: (_key: string, defaultValue?: string) => {
      const [value, setValue] = useState(defaultValue ?? '')
      return [value, setValue, setValue]
    },
    useQueryArrayState: () => {
      const [value, setValue] = useState<string[]>([])
      return [value, setValue, setValue]
    },
  }
})

// ---------------------------------------------------------------------------
// Heavy / unrelated children
// ---------------------------------------------------------------------------
mock.module('@/components/plugin-header', () => ({
  PluginHeader: ({ title, count, actions }: Record<string, unknown>) => (
    <div data-testid="plugin-header">
      <h1>{title as string}</h1>
      <span data-testid="header-count">{String(count ?? '')}</span>
      <div>{actions as React.ReactNode}</div>
    </div>
  ),
}))

mock.module('@/components/facet-filter', () => ({
  FacetFilter: () => null,
}))

mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid={`avatar-${agentId}`} />,
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children, onClick }: Record<string, unknown>) => (
    <button onClick={onClick as () => void}>{children as React.ReactNode}</button>
  ),
}))

mock.module('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder }: Record<string, unknown>) => (
    <input
      data-testid="calendar-search-input"
      value={value as string}
      onChange={onChange as (e: React.ChangeEvent<HTMLInputElement>) => void}
      placeholder={placeholder as string}
    />
  ),
}))

// Stub every lucide icon with a noop span. List all names imported by
// content-calendar so destructured imports resolve.
// CalendarWeek — emit one row per item we receive so we can assert on
// what survives the filter.
mock.module('../../../plugins/messaging/components/calendar-week', () => ({
  CalendarWeek: ({ items }: { items: Array<{ id: string; title: string }> }) => (
    <div data-testid="calendar-week">
      {items.map(it => (
        <div key={it.id} data-testid={`week-item-${it.id}`}>{it.title}</div>
      ))}
    </div>
  ),
}))

mock.module('../../../plugins/messaging/components/item-detail-drawer', () => ({
  ItemDetailDrawer: () => null,
}))

// EventSource shim (jsdom doesn't ship one)
class FakeEventSource {
  url: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  constructor(url: string) {
    this.url = url
  }
  close() {}
}
;(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource

// ---------------------------------------------------------------------------
// Real component under test
// ---------------------------------------------------------------------------
import { ContentCalendar } from '../../../plugins/messaging/components/content-calendar'

const ITEMS = [
  {
    id: 'a',
    title: 'Spring Smoothie',
    agent: 'basil',
    channels: ['general'],
    contentType: 'recipe',
    tone: 'energetic',
    scheduledAt: '2026-04-15T10:00:00Z',
    brief: 'Refreshing morning drink',
    status: 'draft',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    draft: { caption: 'Try this!', agentNotes: 'Use mango' },
  },
  {
    id: 'b',
    title: 'Trail Run Tips',
    agent: 'scout',
    channels: ['general'],
    contentType: 'tip',
    tone: 'energetic',
    scheduledAt: '2026-04-16T10:00:00Z',
    brief: 'Outdoor running advice',
    status: 'draft',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    draft: { caption: 'Hit the trails', agentNotes: 'mention shoes' },
  },
  {
    id: 'c',
    title: 'Mindful Breathing',
    agent: 'zen',
    channels: ['general'],
    contentType: 'motivation',
    tone: 'calm',
    scheduledAt: '2026-04-17T10:00:00Z',
    brief: 'Box breathing intro',
    status: 'draft',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  },
]

function mockFetchItems() {
  globalThis.fetch = mock().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/plugins/messaging/?month=')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: ITEMS }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  mockFetchItems()
})

afterEach(() => cleanup())

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentCalendar (local substring filter)', () => {
  it('renders without crashing', async () => {
    render(<ContentCalendar />)
    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeDefined()
    })
  })

  it('shows all items when search query is empty', async () => {
    render(<ContentCalendar />)
    await waitFor(() => {
      expect(screen.getByTestId('week-item-a')).toBeDefined()
    })
    expect(screen.getByTestId('week-item-b')).toBeDefined()
    expect(screen.getByTestId('week-item-c')).toBeDefined()
  })

  it('exposes the "Search calendar..." placeholder on the input', async () => {
    render(<ContentCalendar />)
    await waitFor(() => {
      expect(screen.getByTestId('calendar-search-input')).toBeDefined()
    })
    expect((screen.getByTestId('calendar-search-input') as HTMLInputElement).placeholder).toBe(
      'Search calendar...',
    )
  })

  it('filters by title substring (case-insensitive)', async () => {
    render(<ContentCalendar />)
    await waitFor(() => {
      expect(screen.getByTestId('week-item-a')).toBeDefined()
    })
    fireEvent.change(screen.getByTestId('calendar-search-input'), { target: { value: 'SMOOTHIE' } })
    await waitFor(() => {
      expect(screen.queryByTestId('week-item-b')).toBeNull()
    })
    expect(screen.getByTestId('week-item-a')).toBeDefined()
    expect(screen.queryByTestId('week-item-c')).toBeNull()
  })

  it('filters by brief substring', async () => {
    render(<ContentCalendar />)
    await waitFor(() => {
      expect(screen.getByTestId('week-item-b')).toBeDefined()
    })
    fireEvent.change(screen.getByTestId('calendar-search-input'), { target: { value: 'breathing' } })
    await waitFor(() => {
      expect(screen.queryByTestId('week-item-a')).toBeNull()
    })
    expect(screen.getByTestId('week-item-c')).toBeDefined()
  })

  it('filters by draft.caption substring', async () => {
    render(<ContentCalendar />)
    await waitFor(() => {
      expect(screen.getByTestId('week-item-a')).toBeDefined()
    })
    fireEvent.change(screen.getByTestId('calendar-search-input'), { target: { value: 'hit the trails' } })
    await waitFor(() => {
      expect(screen.queryByTestId('week-item-a')).toBeNull()
    })
    expect(screen.getByTestId('week-item-b')).toBeDefined()
  })

  it('filters by draft.agentNotes substring', async () => {
    render(<ContentCalendar />)
    await waitFor(() => {
      expect(screen.getByTestId('week-item-a')).toBeDefined()
    })
    fireEvent.change(screen.getByTestId('calendar-search-input'), { target: { value: 'mango' } })
    await waitFor(() => {
      expect(screen.queryByTestId('week-item-b')).toBeNull()
    })
    expect(screen.getByTestId('week-item-a')).toBeDefined()
  })

  it('renders zero items when the query matches nothing', async () => {
    render(<ContentCalendar />)
    await waitFor(() => {
      expect(screen.getByTestId('week-item-a')).toBeDefined()
    })
    fireEvent.change(screen.getByTestId('calendar-search-input'), { target: { value: 'nothing-matches-xyz' } })
    await waitFor(() => {
      expect(screen.queryByTestId('week-item-a')).toBeNull()
    })
    expect(screen.queryByTestId('week-item-b')).toBeNull()
    expect(screen.queryByTestId('week-item-c')).toBeNull()
  })

  it('does not import useSearch — calendar filter is local-only', () => {
    // Per spec §5.1d, the calendar is intentionally NOT Antfly-backed.
    // Read the source file and assert no useSearch import / hook usage exists.
    // (useSearchParams from @bakin/sdk/hooks is fine — it's URL state, not
    // the Bakin search hook — so only `@/hooks/use-search` is forbidden.)
    const source = readFileSync(
      join(__dirname, '../../../plugins/messaging/components/content-calendar.tsx'),
      'utf-8',
    )
    expect(source).not.toMatch(/@\/hooks\/use-search/)
    expect(source).not.toMatch(/from ['"][^'"]*hooks\/use-search['"]/)
  })
})
