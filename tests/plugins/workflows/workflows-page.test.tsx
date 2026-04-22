// @vitest-environment jsdom

/**
 * Smoke test for `plugins/workflows/components/workflows-page.tsx`.
 *
 * Verifies:
 *  1. Renders loading state initially.
 *  2. After fetch resolves, renders workflow cards.
 *  3. Search input filters via the mocked useSearch hook.
 *  4. Falls back to local substring filter when useSearch.results is empty.
 *  5. Clicking a card triggers router.push.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── Test isolation mocks (mandatory per CLAUDE.md) ────────────────────────
//
// This is a pure React component test that does not touch the filesystem,
// but we still mock content-dir + flow-store so an accidental import chain
// cannot leak writes into ~/.bakin/ or ~/.openclaw/.

const testDir = join(tmpdir(), `bakin-test-workflows-page-${Date.now()}`)

vi.mock('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: vi.fn(),
  initBakinHome: vi.fn(),
  isUsingBakinHome: () => false,
}))

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: vi.fn(),
  initBakinHome: vi.fn(),
  isUsingBakinHome: () => false,
}))

vi.mock('../../../plugins/tasks/lib/flow-store', () => ({
  createTask: vi.fn(),
  addTaskLog: vi.fn(),
  moveTask: vi.fn(),
  readTaskboard: vi.fn(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: vi.fn(() => null),
  getTaskWithColumn: vi.fn(() => null),
}))

// ─── Mocks ─────────────────────────────────────────────────────────────────

const routerPush = vi.fn()
vi.mock('@bakin/sdk/hooks', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    useRouter: () => ({
      push: routerPush,
      replace: () => {},
      back: () => {},
      forward: () => {},
      refresh: () => {},
      prefetch: () => {},
    }),
  }
})

// useQueryState — back the value with React state so the input is controlled.
vi.mock('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
}))

// useSearch stub — returns whatever the test sets in `searchState`.
const searchState: {
  results: Array<{ id: string; table: string; score: number; fields: Record<string, unknown> }>
  search: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
} = {
  results: [],
  search: vi.fn(),
  clear: vi.fn(),
}

vi.mock('@/hooks/use-search', () => ({
  useSearch: () => ({
    results: searchState.results,
    aggregations: {},
    loading: false,
    error: null,
    meta: null,
    search: searchState.search,
    clear: searchState.clear,
  }),
}))

// PluginHeader — render only the parts we need to inspect.
vi.mock('@/components/plugin-header', () => ({
  PluginHeader: ({
    title,
    search,
  }: {
    title: string
    search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  }) => (
    <div>
      <h1>{title}</h1>
      {search && (
        <input
          aria-label="search"
          placeholder={search.placeholder}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
        />
      )}
    </div>
  ),
}))

// WorkflowCard — emit a clickable element with the template name.
vi.mock('@bakin/workflows/components/workflow-card', () => ({
  WorkflowCard: ({
    template,
    onClick,
  }: {
    template: { filename: string; definition: { name: string } }
    onClick: () => void
  }) => (
    <button data-testid={`card-${template.filename}`} onClick={onClick}>
      {template.definition.name}
    </button>
  ),
}))

// ─── Fixtures ──────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    filename: 'content-pipeline',
    name: 'content-pipeline',
    definition: {
      name: 'content-pipeline',
      description: 'Generate and publish content',
      steps: [],
    },
  },
  {
    filename: 'onboarding',
    name: 'onboarding',
    definition: {
      name: 'onboarding',
      description: 'Welcome new agents',
      steps: [],
    },
  },
  {
    filename: 'release',
    name: 'release',
    definition: {
      name: 'release',
      description: 'Ship a new build',
      steps: [],
    },
  },
]

// Imported AFTER mocks so the component sees the mocked modules.
import { WorkflowsPage } from '../../../plugins/workflows/components/workflows-page'

// ─── Test Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  routerPush.mockReset()
  searchState.results = []
  searchState.search.mockReset()
  searchState.clear.mockReset()

  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ templates: TEMPLATES }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('WorkflowsPage', () => {
  it('renders the loading state initially', () => {
    // Pin fetch to a never-resolving promise so we stay in loading.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    const { container } = render(<WorkflowsPage />)

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('renders workflow cards after fetch resolves', async () => {
    render(<WorkflowsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('card-content-pipeline')).toBeDefined()
    })
    expect(screen.getByTestId('card-onboarding')).toBeDefined()
    expect(screen.getByTestId('card-release')).toBeDefined()
  })

  it('filters templates via useSearch results when results are present', async () => {
    render(<WorkflowsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('card-content-pipeline')).toBeDefined()
    })

    // Seed useSearch to only match "content-pipeline".
    searchState.results = [
      {
        id: 'def:content-pipeline',
        table: 'bakin_workflows',
        score: 0.99,
        fields: { name: 'content-pipeline' },
      },
    ]

    const input = screen.getByLabelText('search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'pipeline' } })

    // search() should be invoked with the new query.
    await waitFor(() => {
      expect(searchState.search).toHaveBeenCalledWith('pipeline')
    })

    // Only the matched card remains.
    await waitFor(() => {
      expect(screen.getByTestId('card-content-pipeline')).toBeDefined()
      expect(screen.queryByTestId('card-onboarding')).toBeNull()
      expect(screen.queryByTestId('card-release')).toBeNull()
    })
  })

  it('falls back to local substring filter when useSearch.results is empty', async () => {
    render(<WorkflowsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('card-content-pipeline')).toBeDefined()
    })

    // useSearch returns no results — the page must use the local substring filter.
    searchState.results = []

    const input = screen.getByLabelText('search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'onboard' } })

    await waitFor(() => {
      expect(screen.queryByTestId('card-content-pipeline')).toBeNull()
      expect(screen.getByTestId('card-onboarding')).toBeDefined()
      expect(screen.queryByTestId('card-release')).toBeNull()
    })
  })

  it('navigates via router.push when a card is clicked', async () => {
    render(<WorkflowsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('card-onboarding')).toBeDefined()
    })

    fireEvent.click(screen.getByTestId('card-onboarding'))

    expect(routerPush).toHaveBeenCalledWith('/workflows/onboarding')
  })
})
