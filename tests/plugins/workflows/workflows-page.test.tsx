// @vitest-environment jsdom

/**
 * Smoke test for `plugins/workflows/components/workflows-page.tsx`.
 *
 * Verifies:
 *  1. Renders loading state initially.
 *  2. After fetch resolves, renders workflow rows.
 *  3. Search input filters via the mocked useSearch hook.
 *  4. Falls back to local substring filter when useSearch.results is empty.
 *  5. Clicking a row triggers router.push.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── Test isolation mocks (mandatory per CLAUDE.md) ────────────────────────
//
// This is a pure React component test that does not touch the filesystem,
// but we still mock content-dir + task-store so an accidental import chain
// cannot leak writes into ~/.bakin/ or ~/.openclaw/.

const testDir = join(tmpdir(), `bakin-test-workflows-page-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('@/core/task-store', () => ({
  createTask: mock(),
  addTaskLog: mock(),
  moveTask: mock(),
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

// ─── Mocks ─────────────────────────────────────────────────────────────────

const routerPush = mock()
mock.module('@makinbakin/sdk/navigation', () => {
  const React = require('react') as typeof import('react')
  return {
    useRouter: () => ({
      push: routerPush,
      replace: () => {},
      back: () => {},
      forward: () => {},
      refresh: () => {},
      prefetch: () => {},
    }),
    useQueryState: (_key: string, defaultValue: string) => React.useState(defaultValue),
    useQueryArrayState: () => React.useState<string[]>([]),
  }
})

// useQueryState — back the value with React state so the input is controlled.
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
}))

// useSearch stub — returns whatever the test sets in `searchState`.
const searchState: {
  results: Array<{ id: string; table: string; score: number; fields: Record<string, unknown> }>
  meta: { query: string; total: number; took_ms: number; source: 'search' | 'unavailable' } | null
  search: ReturnType<typeof mock>
  clear: ReturnType<typeof mock>
} = {
  results: [],
  meta: null,
  search: mock(),
  clear: mock(),
}

mock.module('@/hooks/use-search', () => ({
  useSearch: () => ({
    results: searchState.results,
    aggregations: {},
    status: 'ok',
    loading: false,
    error: null,
    meta: searchState.meta,
    search: searchState.search,
    clear: searchState.clear,
    retry: mock(),
  }),
}))

// ─── Fixtures ──────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    filename: 'content-pipeline',
    name: 'Content Pipeline',
    source: 'plugin',
    definition: {
      name: 'Content Pipeline',
      description: 'Generate and publish content',
      steps: [
        {
          id: 'review',
          type: 'gate',
          label: 'Review',
        },
      ],
    },
  },
  {
    filename: 'onboarding',
    name: 'onboarding',
    source: 'user',
    definition: {
      name: 'onboarding',
      description: 'Welcome new agents',
      steps: [
        {
          id: 'welcome',
          type: 'workflow',
          label: 'Welcome sequence',
          workflow_id: 'welcome-sequence',
        },
      ],
    },
  },
  {
    filename: 'release',
    name: 'release',
    source: 'plugin',
    disabled: true,
    definition: {
      name: 'release',
      description: 'Ship a new build',
      steps: [
        {
          id: 'release-work',
          type: 'parallel',
          label: 'Release work',
          steps: [
            {
              id: 'notes',
              type: 'agent',
              label: 'Release notes',
              agent: '$assigned',
            },
          ],
        },
      ],
    },
  },
]

// Imported AFTER mocks so the component sees the mocked modules.
import { WorkflowsPage } from '../../../plugins/workflows/components/workflows-page'

// ─── Test Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  routerPush.mockReset()
  searchState.results = []
  searchState.meta = null
  searchState.search.mockReset()
  searchState.clear.mockReset()

  vi.stubGlobal(
    'fetch',
    mock(() =>
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
  vi.unstubAllGlobals()
})

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('WorkflowsPage', () => {
  it('renders one comparison table with source classifications and sortable headings', async () => {
    await act(async () => { render(<WorkflowsPage />) })
    const filters = screen.getByRole('region', { name: 'Workflow filters' })
    expect(filters.querySelectorAll('[data-slot="filter-indicator"]')).toHaveLength(1)
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    const table = screen.getByRole('table', { name: 'Workflows' })
    expect(within(table).getAllByRole('columnheader').map(head => head.textContent)).toEqual([
      'Workflow', 'Source', 'Steps', 'Features', 'Assignment',
    ])
    expect(table.querySelectorAll('tbody > tr')).toHaveLength(3)
    expect(table.querySelector('[data-slot="card"]')).toBeNull()
    for (const head of within(table).getAllByRole('columnheader')) {
      expect(within(head).getByRole('button')).toBeDefined()
    }
    expect(within(table).getByText('Custom').getAttribute('data-variant')).toBe('soft')
    expect(within(table).getAllByText('Managed')).toHaveLength(2)
    expect(screen.getByText('disabled')).toBeDefined()
    await act(async () => { fireEvent.click(screen.getByRole('row', { name: 'Open release' })) })
    expect(routerPush).toHaveBeenCalledWith('/workflows/release')
  })

  it('renders the loading state initially', async () => {
    // Pin fetch to a never-resolving promise so we stay in loading.
    vi.stubGlobal('fetch', mock(() => new Promise(() => {})))

    const { container } = render(<WorkflowsPage />)

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.getByRole('table', { name: 'Loading workflows' }).getAttribute('aria-busy')).toBe('true')
  })

  it('paginates the whole collection and sorts before slicing, preserving show-all', async () => {
    const templates = [TEMPLATES[1], ...Array.from({ length: 20 }, (_, i) => ({
      ...TEMPLATES[0], filename: `managed-${i}`, name: `Managed ${i}`,
    }))]
    vi.stubGlobal('fetch', mock(async () => new Response(JSON.stringify({ templates }))))
    await act(async () => { render(<WorkflowsPage />) })
    const managed = () => screen.getByRole('table', { name: 'Workflows' })
    expect(managed().querySelectorAll('tbody > tr')).toHaveLength(20)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    expect(managed().querySelectorAll('tbody > tr')).toHaveLength(1)
    expect(within(managed()).getByText('Managed 19')).toBeDefined()
    expect(screen.queryByRole('row', { name: 'Open onboarding' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Workflow' })) })
    expect(managed().querySelectorAll('tbody > tr')).toHaveLength(20)
    expect(within(managed()).getByRole('columnheader', { name: 'Workflow' }).getAttribute('aria-sort')).toBe('ascending')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Workflow' })) })
    expect(managed().querySelector('tbody > tr')?.textContent).toContain('onboarding')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /show all/i })) })
    expect(managed().querySelectorAll('tbody > tr')).toHaveLength(21)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Source' })) })
    expect(managed().querySelectorAll('tbody > tr')).toHaveLength(21)
  })

  it('combines source with search and features, with one empty state and clear recovery', async () => {
    const user = userEvent.setup()
    await act(async () => { render(<WorkflowsPage />) })
    await user.click(screen.getByRole('combobox', { name: 'Workflow source' }))
    await user.click(await screen.findByRole('option', { name: 'Custom' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(screen.getByTestId('row-onboarding')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Features, 0 selected' }))
    await user.click(await screen.findByRole('option', { name: /Approval gates/ }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByText('No workflows match this view')).toBeDefined())
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4))
    expect(screen.getByRole('combobox', { name: 'Workflow source' }).textContent).toContain('All sources')
    await user.click(screen.getByRole('combobox', { name: 'Workflow source' }))
    await user.click(await screen.findByRole('option', { name: 'Managed' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Workflow search' }), { target: { value: 'onboarding' } })
    await waitFor(() => expect(screen.getByText('No workflows match this view')).toBeDefined())
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('keeps no-results recovery distinct from an initially empty collection', async () => {
    await act(async () => { render(<WorkflowsPage />) })
    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Workflow search' }), { target: { value: 'no-match' } })
    })
    expect(screen.getByText('No workflows match this view')).toBeDefined()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })) })
    expect(screen.getByRole('table', { name: 'Workflows' })).toBeDefined()
  })

  it('shows the create action instead of empty groups when no definitions exist', async () => {
    vi.stubGlobal('fetch', mock(async () => new Response(JSON.stringify({ templates: [] }))))
    await act(async () => { render(<WorkflowsPage />) })
    expect(screen.getByText('No workflows yet')).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('button', { name: /New workflow/i })).toHaveLength(2)
  })

  it('renders workflow rows after fetch resolves', async () => {
    await act(async () => {
      render(<WorkflowsPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('row-content-pipeline')).toBeDefined()
    })
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.getByTestId('row-onboarding')).toBeDefined()
    expect(screen.getByTestId('row-release')).toBeDefined()
  })

  it('filters workflows by reusable workflow features', async () => {
    render(<WorkflowsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('row-content-pipeline')).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Features, 0 selected' }))
    fireEvent.click(within(document.body).getByRole('option', { name: /Approval gates 1/i }))

    await waitFor(() => {
      expect(screen.getByTestId('row-content-pipeline')).toBeDefined()
      expect(screen.queryByTestId('row-onboarding')).toBeNull()
      expect(screen.queryByTestId('row-release')).toBeNull()
    })
  })

  it('filters templates via useSearch results when results are present', async () => {
    await act(async () => {
      render(<WorkflowsPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('row-content-pipeline')).toBeDefined()
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
    searchState.meta = { query: 'pipeline', total: 1, took_ms: 1, source: 'search' }

    const input = screen.getByRole('searchbox', { name: 'Workflow search' }) as HTMLInputElement
    await act(async () => { fireEvent.change(input, { target: { value: 'pipeline' } }) })

    // search() should be invoked with the new query.
    await waitFor(() => {
      expect(searchState.search).toHaveBeenCalledWith('pipeline')
    })

    // Only the matched row remains.
    await waitFor(() => {
      expect(screen.getByTestId('row-content-pipeline')).toBeDefined()
      expect(screen.queryByTestId('row-onboarding')).toBeNull()
      expect(screen.queryByTestId('row-release')).toBeNull()
    })
  })

  it('falls back to local filtering when search returns only workflow instance rows', async () => {
    await act(async () => {
      render(<WorkflowsPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('row-content-pipeline')).toBeDefined()
    })

    searchState.results = [
      {
        id: 'inst:task-123',
        table: 'bakin_workflows',
        score: 0.88,
        fields: { name: 'Onboarding instance', type: 'instance' },
      },
    ]

    const input = screen.getByRole('searchbox', { name: 'Workflow search' }) as HTMLInputElement
    await act(async () => { fireEvent.change(input, { target: { value: 'onboard' } }) })

    await waitFor(() => {
      expect(screen.getByTestId('row-onboarding')).toBeDefined()
      expect(screen.queryByTestId('row-content-pipeline')).toBeNull()
      expect(screen.queryByTestId('row-release')).toBeNull()
    })
  })

  it('falls back to local substring filter when useSearch.results is empty', async () => {
    await act(async () => {
      render(<WorkflowsPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('row-content-pipeline')).toBeDefined()
    })

    // useSearch returns no results — the page must use the local substring filter.
    searchState.results = []

    const input = screen.getByRole('searchbox', { name: 'Workflow search' }) as HTMLInputElement
    await act(async () => { fireEvent.change(input, { target: { value: 'onboard' } }) })

    await waitFor(() => {
      expect(screen.queryByTestId('row-content-pipeline')).toBeNull()
      expect(screen.getByTestId('row-onboarding')).toBeDefined()
      expect(screen.queryByTestId('row-release')).toBeNull()
    })
  })

  it('ignores stale search results from a previous query while filtering the current query', async () => {
    await act(async () => {
      render(<WorkflowsPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('row-content-pipeline')).toBeDefined()
    })

    searchState.results = [
      {
        id: 'def:content-pipeline',
        table: 'bakin_workflows',
        score: 0.92,
        fields: { name: 'Content Pipeline', type: 'definition' },
      },
    ]
    searchState.meta = { query: 'content', total: 1, took_ms: 1, source: 'search' }

    const input = screen.getByRole('searchbox', { name: 'Workflow search' }) as HTMLInputElement
    await act(async () => { fireEvent.change(input, { target: { value: 'onboard' } }) })

    await waitFor(() => {
      expect(screen.getByTestId('row-onboarding')).toBeDefined()
      expect(screen.queryByTestId('row-content-pipeline')).toBeNull()
    })
  })

  it('navigates via router.push when a row is clicked', async () => {
    await act(async () => {
      render(<WorkflowsPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('row-onboarding')).toBeDefined()
    })

    await act(async () => { fireEvent.click(screen.getByRole('row', { name: /Open onboarding/i })) })

    expect(routerPush).toHaveBeenCalledWith('/workflows/onboarding')
  })

  it('creates a workflow from the list modal before navigating to the editor', async () => {
    const fetchMock = mock((url: string, init?: RequestInit) => {
      if (url === '/api/plugins/workflows/definitions' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'custom-launch', source: 'user' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ templates: TEMPLATES }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<WorkflowsPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('row-onboarding')).toBeDefined()
    })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /new workflow/i })) })
    expect(routerPush).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByText('Create workflow').length).toBeGreaterThan(0)
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText(/workflow name/i), {
        target: { value: 'Launch Plan' },
      })
    })
    expect((within(dialog).getByLabelText(/workflow id/i) as HTMLInputElement).value).toBe('launch-plan')
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText(/workflow id/i), {
        target: { value: 'custom-launch' },
      })
    })
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText(/workflow name/i), {
        target: { value: 'Launch Plan Updated' },
      })
    })
    expect((within(dialog).getByLabelText(/workflow id/i) as HTMLInputElement).value).toBe('custom-launch')
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText(/description/i), {
        target: { value: 'Plan and approve a campaign launch.' },
      })
    })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /create workflow/i })) })

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/workflows/custom-launch/edit'))
    const [, init] = fetchMock.mock.calls.find(([url, request]) => (
      url === '/api/plugins/workflows/definitions' && request?.method === 'POST'
    ))!
    const body = JSON.parse(init!.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      id: 'custom-launch',
      name: 'Launch Plan Updated',
      description: 'Plan and approve a campaign launch.',
      version: 1,
      steps: [],
    })
  })

  it('shows field-level create workflow validation before posting', async () => {
    await act(async () => {
      render(<WorkflowsPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('row-onboarding')).toBeDefined()
    })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /new workflow/i })) })
    const dialog = screen.getByRole('dialog')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /create workflow/i })) })

    expect(within(dialog).getByText('Workflow name is required.')).toBeDefined()
    expect(within(dialog).getByText('Workflow id is required.')).toBeDefined()
    expect(within(dialog).queryByText(/validation failed/i)).toBeNull()
    expect((globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls).toHaveLength(1)
  })

  it('explains stale empty-step server validation during workflow creation', async () => {
    const fetchMock = mock((url: string, init?: RequestInit) => {
      if (url === '/api/plugins/workflows/definitions' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({
            error: 'validation failed',
            issues: [
              {
                code: 'too_small',
                path: ['steps'],
                message: 'Too small: expected array to have >=1 items',
              },
            ],
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ templates: TEMPLATES }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<WorkflowsPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('row-onboarding')).toBeDefined()
    })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /new workflow/i })) })
    const dialog = screen.getByRole('dialog')
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText(/workflow name/i), {
        target: { value: 'Testing' },
      })
    })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /create workflow/i })) })

    await waitFor(() => {
      expect(within(dialog).getByText(/old server schema/i)).toBeDefined()
    })
    expect(within(dialog).queryByText(/^validation failed$/i)).toBeNull()
  })
})
