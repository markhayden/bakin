// @vitest-environment jsdom

/**
 * ProjectGrid component smoke — verifies the projects list page renders,
 * fetches the project list, integrates with the mocked useSearch hook,
 * filters/reorders by score when results return, and falls back to a
 * local substring filter when useSearch is empty.
 *
 * Per CLAUDE.md test rules, every filesystem-touching module is mocked to
 * a temp directory even though this is a pure component test — defensive
 * isolation prevents accidental ~/.bakin/ writes.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mandatory CLAUDE.md test mocks
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-projects-search-${Date.now()}`)
mkdirSync(testDir, { recursive: true })

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

mock.module('@/core/openclaw-client', () => ({
  sendToAgent: mock(),
  sendMessage: mock(),
}))

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Stubs for client-only integrations
// ---------------------------------------------------------------------------

// useQueryState: simple controllable [value, setter] pair per key.
const queryState: Record<string, string> = {}
const querySetters: Record<string, (v: string) => void> = {}

function setQueryStateValue(key: string, value: string) {
  queryState[key] = value
  querySetters[key]?.(value)
}

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string = '') => {
    const [value, setValue] = React.useState<string>(queryState[key] ?? defaultValue)
    querySetters[key] = setValue
    const setter = (v: string) => {
      queryState[key] = v
      setValue(v)
    }
    return [value, setter, setter]
  },
  useQueryArrayState: (key: string) => {
    const [value, setValue] = React.useState<string[]>([])
    querySetters[key] = (v: string) => setValue(v ? v.split(',') : [])
    return [value, setValue]
  },
}))

// useSearch: controllable mock — tests can configure results before render.
type StubSearchResult = {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
}

let stubSearchResults: StubSearchResult[] = []
const searchSpy = mock<(q: string) => void>()
const clearSpy = mock<() => void>()

mock.module('@/hooks/use-search', () => ({
  useSearch: () => ({
    results: stubSearchResults,
    aggregations: {},
    loading: false,
    error: null,
    meta: null,
    search: searchSpy,
    clear: clearSpy,
  }),
  reorderBySearchResults: <T extends { id: string }>(items: T[]) => items,
}))

// ---------------------------------------------------------------------------
// Stub UI shells so we don't pull in tailwind/cn or large component graphs.
// ---------------------------------------------------------------------------

mock.module('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

mock.module('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

mock.module('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

// project-card has its own dependencies — stub it to a simple title button.
mock.module('../../../plugins/projects/components/project-card', () => ({
  ProjectCard: ({ project, onClick }: { project: { id: string; title: string }; onClick: () => void }) => (
    <button data-testid={`project-card-${project.id}`} onClick={onClick}>
      {project.title}
    </button>
  ),
}))

// ---------------------------------------------------------------------------
// Module under test (imported AFTER mocks)
// ---------------------------------------------------------------------------

import { ProjectGrid } from '../../../plugins/projects/components/project-grid'

// ---------------------------------------------------------------------------
// Fixtures + fetch stub
// ---------------------------------------------------------------------------

const fixtureProjects = [
  {
    id: 'p1',
    title: 'Alpha Launch',
    status: 'active',
    progress: 50,
    taskCount: 3,
    updated: '2026-04-10T00:00:00Z',
  },
  {
    id: 'p2',
    title: 'Beta Roadmap',
    status: 'active',
    progress: 25,
    taskCount: 2,
    updated: '2026-04-09T00:00:00Z',
  },
  {
    id: 'p3',
    title: 'Gamma Cleanup',
    status: 'draft',
    progress: 10,
    taskCount: 1,
    updated: '2026-04-08T00:00:00Z',
  },
]

const fetchMock = mock(async () => ({
  ok: true,
  json: async () => ({ projects: fixtureProjects }),
})) as unknown as typeof fetch

beforeEach(() => {
  for (const k of Object.keys(queryState)) delete queryState[k]
  for (const k of Object.keys(querySetters)) delete querySetters[k]
  stubSearchResults = []
  searchSpy.mockClear()
  clearSpy.mockClear()
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock
  ;(fetchMock as unknown as { mockClear: () => void }).mockClear?.()
})

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectGrid', () => {
  it('renders the search input from PluginHeader', async () => {
    render(<ProjectGrid />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search projects...')).toBeDefined()
    })
  })

  it('renders project cards from the fetched list', async () => {
    render(<ProjectGrid />)

    await waitFor(() => {
      expect(screen.getByTestId('project-card-p1')).toBeDefined()
      expect(screen.getByTestId('project-card-p2')).toBeDefined()
      expect(screen.getByTestId('project-card-p3')).toBeDefined()
    })
    expect(screen.getByText('Alpha Launch')).toBeDefined()
  })

  it('calls useSearch.search() when the URL search state updates', async () => {
    render(<ProjectGrid />)

    await waitFor(() => {
      expect(screen.getByTestId('project-card-p1')).toBeDefined()
    })

    act(() => {
      setQueryStateValue('q', 'alpha')
    })

    await waitFor(() => {
      expect(searchSpy).toHaveBeenCalledWith('alpha')
    })
  })

  it('filters and reorders the list to match useSearch results by score', async () => {
    stubSearchResults = [
      { id: 'p2', table: 'bakin_projects', score: 0.95, fields: {} },
      { id: 'p1', table: 'bakin_projects', score: 0.4, fields: {} },
    ]

    render(<ProjectGrid />)

    await waitFor(() => {
      expect(screen.getByTestId('project-card-p1')).toBeDefined()
    })

    act(() => {
      setQueryStateValue('q', 'launch')
    })

    await waitFor(() => {
      // p3 is excluded entirely; p1 and p2 remain
      expect(screen.queryByTestId('project-card-p3')).toBeNull()
      expect(screen.queryByTestId('project-card-p1')).not.toBeNull()
      expect(screen.queryByTestId('project-card-p2')).not.toBeNull()
    })

    // p2 (higher score) should appear before p1 in the DOM order
    const cards = screen.getAllByTestId(/^project-card-/)
    const ids = cards.map((c) => c.getAttribute('data-testid'))
    expect(ids.indexOf('project-card-p2')).toBeLessThan(ids.indexOf('project-card-p1'))
  })

  it('falls back to local substring filter on title when useSearch returns empty', async () => {
    stubSearchResults = []

    render(<ProjectGrid />)

    await waitFor(() => {
      expect(screen.getByTestId('project-card-p1')).toBeDefined()
    })

    act(() => {
      setQueryStateValue('q', 'beta')
    })

    await waitFor(() => {
      expect(screen.queryByTestId('project-card-p2')).not.toBeNull()
      expect(screen.queryByTestId('project-card-p1')).toBeNull()
      expect(screen.queryByTestId('project-card-p3')).toBeNull()
    })
  })
})
