// @vitest-environment jsdom

/**
 * Tests for `plugins/workflows/components/workflow-editor.tsx`.
 *
 * The editor is a thin form over the CRUD routes. It does NOT touch the
 * filesystem itself — fetch is mocked. Tests still mock content-dir + the
 * tasks flow-store so accidental import chains can't leak writes into
 * ~/.bakin/ (mandatory per CLAUDE.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-workflow-editor-${Date.now()}`)

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
vi.mock('../../../plugins/tasks/lib/flow-store', () => ({}))
vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

// Stub agent-store + avatar so the AgentSelect drop-down has something to render
vi.mock('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => [
    { id: 'basil', name: 'Basil' },
    { id: 'pixel', name: 'Pixel' },
  ],
}))
vi.mock('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
}))

// Imported AFTER mocks so the component picks them up.
import { WorkflowEditor } from '../../../plugins/workflows/components/workflow-editor'
import type { WorkflowDefinition } from '../../../plugins/workflows/types'

const sampleDefinition: WorkflowDefinition = {
  name: 'Video Script',
  description: 'Write a script then approve it',
  version: 1,
  steps: [
    { id: 'write-script', type: 'agent', label: 'Write Script', agent: 'basil' },
    {
      id: 'script-gate',
      type: 'gate',
      label: 'Approve Script',
      approval_required: true,
      on_approve: 'done',
    },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ id: 'video-script', source: 'user' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkflowEditor', () => {
  it('renders top-level fields and an empty step list in create mode', () => {
    render(<WorkflowEditor mode="create" />)

    expect(screen.getByLabelText(/^name/i)).toBeDefined()
    expect(screen.getByLabelText(/description/i)).toBeDefined()
    expect(screen.getByText(/no steps yet/i)).toBeDefined()
  })

  it('hydrates form fields from initialDefinition in edit mode', () => {
    render(
      <WorkflowEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe('Video Script')
    expect(screen.getByDisplayValue('Write Script')).toBeDefined()
    expect(screen.getByDisplayValue('Approve Script')).toBeDefined()
  })

  it('adds a new agent step when "Add Agent Step" is clicked', () => {
    render(<WorkflowEditor mode="create" />)

    fireEvent.click(screen.getByRole('button', { name: /add agent step/i }))

    expect(screen.queryByText(/no steps yet/i)).toBeNull()
    expect(screen.getByPlaceholderText(/step id/i)).toBeDefined()
  })

  it('removes a step when the remove control is clicked', () => {
    render(
      <WorkflowEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    expect(screen.getAllByPlaceholderText(/step id/i)).toHaveLength(2)

    const removeButtons = screen.getAllByRole('button', { name: /remove step/i })
    fireEvent.click(removeButtons[0])

    expect(screen.getAllByPlaceholderText(/step id/i)).toHaveLength(1)
  })

  it('saves a new workflow via POST /definitions in create mode', async () => {
    render(<WorkflowEditor mode="create" />)

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Test Flow' } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'a test' } })

    fireEvent.click(screen.getByRole('button', { name: /add agent step/i }))
    fireEvent.change(screen.getByPlaceholderText(/step id/i), { target: { value: 's1' } })
    fireEvent.change(screen.getByPlaceholderText(/^label/i), { target: { value: 'Do the thing' } })

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.name).toBe('Test Flow')
    expect(body.id).toBeTruthy()
    expect(body.steps).toHaveLength(1)
    expect(body.steps[0]).toMatchObject({ id: 's1', type: 'agent', label: 'Do the thing' })
  })

  it('updates an existing workflow via PUT /definitions/:name in edit mode (user source)', async () => {
    render(
      <WorkflowEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Video Script Updated' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions/video-script')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body.name).toBe('Video Script Updated')
  })

  it('shows a "Save as new" action on plugin workflows and POSTs with a new id', async () => {
    const onSaved = vi.fn()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'video-script-copy', source: 'user' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(
      <WorkflowEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="plugin"
        onSaved={onSaved}
      />,
    )

    // Plugin source must NOT show a plain Save button — only Save as new
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /save as new/i }))
    fireEvent.change(screen.getByLabelText(/new id/i), { target: { value: 'video-script-copy' } })
    fireEvent.click(screen.getByRole('button', { name: /^create copy$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.id).toBe('video-script-copy')

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('video-script-copy'))
  })

  it('hides the Delete control on plugin workflows', () => {
    render(
      <WorkflowEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="plugin"
      />,
    )

    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
  })

  it('deletes a user workflow via DELETE when confirmed', async () => {
    const onDeleted = vi.fn()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'video-script', deleted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(
      <WorkflowEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
        onDeleted={onDeleted}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    // Confirm dialog
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions/video-script')
    expect(init.method).toBe('DELETE')
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })

  it('surfaces a server validation error on save', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'validation failed', issues: [{ message: 'name required' }] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(<WorkflowEditor mode="create" />)
    // Name is required by client-side guard before POST — fill it so the test
    // exercises the server-error path, not the local guard.
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Bad Flow' } })
    fireEvent.click(screen.getByRole('button', { name: /add agent step/i }))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(screen.getByText(/validation failed/i)).toBeDefined()
    })
  })
})
