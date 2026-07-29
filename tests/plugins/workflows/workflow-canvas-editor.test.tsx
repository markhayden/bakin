// @vitest-environment jsdom

/**
 * Smoke test for `plugins/workflows/components/workflow-canvas-editor.tsx`.
 *
 * Scope (T9 scaffold): loading a definition, saving back via PUT, and
 * verifying that layout.positions is included in the save payload. The
 * xyflow ReactFlow component is stubbed out — we don't exercise its
 * internals here, just the wiring layer.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-canvas-editor-${Date.now()}`)
let latestHistoryBlock: {
  enableBeforeUnload?: boolean
  blockerFn: (args: {
    action: string
    currentLocation: { pathname: string }
    nextLocation: { pathname: string }
  }) => Promise<boolean>
} | null = null
let unblockHistory: ReturnType<typeof mock>

// CLAUDE.md — content-dir mock even for pure UI tests.
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
  readTaskboard: mock(() => ({ columns: {} })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

mock.module('@tanstack/react-router', () => ({
  useRouter: () => ({
    parseLocation: (location: { pathname: string }) => location,
    history: {
      block: (options: typeof latestHistoryBlock) => {
        latestHistoryBlock = options
        return unblockHistory
      },
    },
  }),
  useNavigate: () => mock(),
  useLocation: () => ({ pathname: '/workflows/video-script/edit', search: {} }),
  useParams: () => ({}),
}))

interface ReactFlowStubProps {
  children?: React.ReactNode
  nodes?: Array<{
    id: string
    className?: string
    data?: {
      insertIndex?: number
      onInsert?: (kind: string, index: number) => void
      onOpenPalette?: () => void
    }
    selected?: boolean
    initialWidth?: number
    initialHeight?: number
    measured?: { width?: number; height?: number }
    style?: { width?: number; height?: number }
  }>
  edges?: Array<{
    id: string
    source: string
    target: string
    data?: {
      insertIndex?: number
      onInsert?: (kind: string, index: number) => void
      onOpenPalette?: () => void
    }
  }>
  onNodeClick?: (event: React.MouseEvent, node: { id: string }) => void
  onPaneClick?: React.MouseEventHandler<HTMLDivElement>
  onDragOver?: React.DragEventHandler<HTMLDivElement>
  onDrop?: React.DragEventHandler<HTMLDivElement>
  nodesConnectable?: boolean
  nodeTypes?: Record<string, unknown>
}

// Stub xyflow so we render in jsdom without pulling its real DOM layer. The
// stub exposes the controlled node/edge props so editor tests can assert the
// Bakin workflow contract without depending on React Flow internals.
mock.module('@xyflow/react', () => ({
  __esModule: true,
  ReactFlow: (props: ReactFlowStubProps) => {
    const {
      children,
      nodes = [],
      edges = [],
      onNodeClick,
      onPaneClick,
      onDragOver,
      onDrop,
      nodesConnectable,
      nodeTypes = {},
    } = props
    return (
      <div
        data-testid="react-flow-stub"
        data-connectable={String(nodesConnectable)}
        data-node-types={Object.keys(nodeTypes).sort().join(',')}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={(event) => {
          if (event.target === event.currentTarget) onPaneClick?.(event)
        }}
      >
        <div data-testid="flow-nodes">
          {nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              data-testid={`node-${node.id}`}
              data-class-name={node.className ?? ''}
              data-selected={String(node.selected ?? false)}
              data-node-data={JSON.stringify(node.data ?? {})}
              data-initial-size={`${node.initialWidth ?? ''}x${node.initialHeight ?? ''}`}
              data-measured-size={`${node.measured?.width ?? ''}x${node.measured?.height ?? ''}`}
              data-style-size={`${node.style?.width ?? ''}x${node.style?.height ?? ''}`}
              onClick={(event) => onNodeClick?.(event, node)}
            >
              {node.id}
            </button>
          ))}
        </div>
        <div data-testid="flow-edges">
          {edges.map((edge) => (
            <span
              key={edge.id}
              data-testid={`edge-${edge.source}-${edge.target}`}
            >
              {edge.data?.onInsert && (
                <>
                  <button
                    type="button"
                    data-testid={`insert-${edge.source}-${edge.target}`}
                    onClick={() => edge.data?.onInsert?.('agent', edge.data.insertIndex ?? 0)}
                  >
                    Insert agent
                  </button>
                  <button
                    type="button"
                    data-testid={`insert-output-${edge.source}-${edge.target}`}
                    onClick={() => edge.data?.onInsert?.('output', edge.data.insertIndex ?? 0)}
                  >
                    Insert output
                  </button>
                </>
              )}
              {edge.data?.onOpenPalette && (
                <button
                  type="button"
                  data-testid={`open-palette-${edge.source}-${edge.target}`}
                  onClick={() => edge.data?.onOpenPalette?.()}
                >
                  Open palette
                </button>
              )}
            </span>
          ))}
        </div>
        {children}
      </div>
    )
  },
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MiniMap: () => null,
  NodeToolbar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="node-toolbar">{children}</div>
  ),
  Panel: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="flow-panel">{children}</div>
  ),
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  getSmoothStepPath: () => ['M0 0 L1 1', 0, 0],
  applyNodeChanges: (_c: unknown, nds: unknown) => nds,
  applyEdgeChanges: (_c: unknown, eds: unknown) => eds,
}))

// Stub palette + drawer — they have their own dedicated tests. Keeps
// canvas-editor tests focused on the save pipeline.
mock.module('../../../plugins/workflows/components/node-type-palette', () => ({
  NodeTypePalette: ({
    collapsed,
    disabledKinds,
    onCollapsedChange,
  }: {
    collapsed?: boolean
    disabledKinds?: ReadonlySet<string>
    onCollapsedChange?: (collapsed: boolean) => void
  }) => (
    <aside
      data-testid="node-type-palette"
      data-collapsed={String(collapsed ?? false)}
      data-disabled-kinds={Array.from(disabledKinds ?? []).sort().join(',')}
    >
      <button type="button" data-testid="collapse-palette" onClick={() => onCollapsedChange?.(true)}>
        Collapse palette
      </button>
    </aside>
  ),
  PALETTE_DRAG_MIME_TYPE: 'application/x-bakin-node-kind',
}))
mock.module('../../../plugins/workflows/components/node-config-drawer', () => ({
  NodeConfigDrawer: ({
    step,
    onClose,
    onDirtyChange,
  }: {
    step: { id: string }
    onClose?: () => void
    onDirtyChange?: (dirty: boolean) => void
  }) => (
    <aside data-testid="node-config-drawer" data-step-id={step.id}>
      {step.id}
      <button type="button" onClick={onClose}>
        Close node drawer
      </button>
      <button type="button" onClick={() => onDirtyChange?.(true)}>
        Mark node dirty
      </button>
    </aside>
  ),
}))

// Imported AFTER mocks.
import { WorkflowCanvasEditor } from '../../../plugins/workflows/components/workflow-canvas-editor'
import type { WorkflowDefinition } from '../../../plugins/workflows/types'
import { registerNodeRenderer, unregisterNodeRenderer } from '../../../plugins/workflows/lib/node-renderer-registry'

// The editor consumes node renderers from the registry (populated by client.tsx
// in the running app); only 'appendStep' is a builtin fallback. Mirror that
// registration here so nodeTypes carries the real kinds.
const REGISTERED_NODE_KINDS = ['trigger', 'agent', 'gate', 'parallel', 'output', 'workflow', 'createTask', 'subflowGroup'] as const
const StubNodeRenderer = () => null

const sampleDefinition: WorkflowDefinition = {
  name: 'Video Script',
  description: 'Write a script',
  version: 1,
  steps: [
    { id: 'write', type: 'agent', label: 'Write', agent: 'chef' },
    { id: 'review', type: 'gate', label: 'Review' },
  ],
  layout: {
    positions: {
      write: { x: 100, y: 50 },
      review: { x: 100, y: 200 },
    },
  },
}

let fetchMock: ReturnType<typeof mock>

beforeEach(() => {
  latestHistoryBlock = null
  unblockHistory = mock()
  fetchMock = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({ id: 'video-script', source: 'user' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  for (const kind of REGISTERED_NODE_KINDS) registerNodeRenderer(kind, StubNodeRenderer)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const kind of REGISTERED_NODE_KINDS) unregisterNodeRenderer(kind)
})

function closeNodeDrawer() {
  fireEvent.click(screen.getByRole('button', { name: /close node drawer/i }))
}

function nodeData(id: string): Record<string, unknown> {
  return JSON.parse(screen.getByTestId(`node-${id}`).getAttribute('data-node-data') || '{}') as Record<string, unknown>
}

function getFullWorkspaceHeader(): HTMLElement {
  const header = document.querySelector('[data-slot="workspace-page-header"]')
  if (!(header instanceof HTMLElement)) {
    throw new Error('Expected the full workspace header to be rendered')
  }
  return header
}

function getEditorHeaderButton(name: RegExp): HTMLButtonElement {
  return within(getFullWorkspaceHeader()).getByRole('button', { name }) as HTMLButtonElement
}

function getCanvasSaveButton(): HTMLButtonElement {
  const actions = document.querySelector('[data-workflow-editor-header-actions]')
  if (!(actions instanceof HTMLElement)) {
    throw new Error('Expected the workflow editor header actions to be rendered')
  }
  return within(actions).getByRole('button', { name: /^save$/i }) as HTMLButtonElement
}

describe('WorkflowCanvasEditor', () => {
  it('renders the toolbar with the workflow id in edit mode', () => {
    const onCancel = mock()
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
        onCancel={onCancel}
      />,
    )
    expect(within(getFullWorkspaceHeader()).getByText('Video Script')).toBeDefined()
    expect(screen.getByText('video-script')).toBeDefined()
    expect(screen.getByText('Write a script')).toBeDefined()
    expect(getEditorHeaderButton(/edit workflow details/i)).toBeDefined()
    const headerActions = document.querySelector('[data-workflow-editor-header-actions]')
    expect(headerActions).not.toBeNull()
    expect(within(headerActions as HTMLElement).getByRole('button', { name: /^save$/i })).toBeDefined()
    expect(getEditorHeaderButton(/workflow actions/i)).toBeDefined()
    expect(headerActions?.className).toContain('items-center')
    fireEvent.click(getEditorHeaderButton(/back to workflows/i))
    expect(onCancel).toHaveBeenCalled()
    expect(getCanvasSaveButton()).toBeDefined()
  })

  it('labels user workflows that shadow a managed default', () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
        shadowedSource={{ source: 'plugin', pluginId: 'workflows' }}
      />,
    )

    expect(screen.getByText('Shadows managed default')).toBeDefined()
  })

  it('saves workflow metadata from the details drawer in edit mode', async () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    const canvasSave = getCanvasSaveButton()
    expect(canvasSave.disabled).toBe(false)

    fireEvent.click(getEditorHeaderButton(/edit workflow details/i))
    expect(screen.getByText('Workflow details')).toBeDefined()
    expect(canvasSave.disabled).toBe(true)
    const cancel = screen.getByRole('button', { name: /cancel/i })
    const saveDetails = screen.getByRole('button', { name: /save details/i })
    expect(cancel.compareDocumentPosition(saveDetails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/^name/i), {
      target: { value: 'Video Script Draft' },
    })
    fireEvent.change(screen.getByLabelText(/^description/i), {
      target: { value: 'Draft and review a video script.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save details/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(canvasSave.disabled).toBe(false))
    expect(within(getFullWorkspaceHeader()).getByText('Video Script Draft')).toBeDefined()
    expect(screen.getByText('Draft and review a video script.')).toBeDefined()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions/video-script')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    expect(body.name).toBe('Video Script Draft')
    expect(body.description).toBe('Draft and review a video script.')
  })

  it('disables the canvas Save button while a step drawer is open', () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    const canvasSave = getCanvasSaveButton()
    expect(canvasSave.disabled).toBe(false)
    fireEvent.click(screen.getByTestId('node-write'))
    expect(screen.getByTestId('node-config-drawer')).toBeDefined()
    expect(canvasSave.disabled).toBe(true)
    closeNodeDrawer()
    expect(canvasSave.disabled).toBe(false)
  })

  it('saves via PUT and includes layout.positions in the payload', async () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /auto-arrange/i }))
    fireEvent.click(getCanvasSaveButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions/video-script')
    expect(init.method).toBe('PUT')

    const body = JSON.parse(init.body as string) as WorkflowDefinition
    expect(body.name).toBe('Video Script')
    expect(body.layout?.positions?.write).toBeDefined()
    expect(body.layout?.positions?.review).toBeDefined()
  })

  it('does not rewrite a clean workflow when Save is clicked unchanged', () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )
    fireEvent.click(getCanvasSaveButton())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a workflow from the setup dialog before entering the canvas', async () => {
    const onSaved = mock()
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'launch-plan', source: 'user' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    render(
      <WorkflowCanvasEditor
        mode="create"
        onSaved={onSaved}
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByText('Create workflow').length).toBeGreaterThan(0)

    fireEvent.change(within(dialog).getByLabelText(/workflow name/i), {
      target: { value: 'Launch Plan' },
    })
    expect((within(dialog).getByLabelText(/workflow id/i) as HTMLInputElement).value).toBe('launch-plan')
    fireEvent.change(within(dialog).getByLabelText(/description/i), {
      target: { value: 'Plan and approve a campaign launch.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /create workflow/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as WorkflowDefinition & { id: string }
    expect(body.id).toBe('launch-plan')
    expect(body.name).toBe('Launch Plan')
    expect(body.description).toBe('Plan and approve a campaign launch.')
    expect(body.steps).toEqual([])
    expect(onSaved).toHaveBeenCalledWith('launch-plan')
  })

  it('shows field-level setup validation before creating a workflow', () => {
    render(
      <WorkflowCanvasEditor
        mode="create"
      />,
    )

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /create workflow/i }))

    expect(within(dialog).getByText('Workflow name is required.')).toBeDefined()
    expect(within(dialog).getByText('Workflow id is required.')).toBeDefined()
    expect(within(dialog).queryByText(/validation failed/i)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('explains stale empty-step server validation in the setup dialog', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
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
      ),
    )

    render(
      <WorkflowCanvasEditor
        mode="create"
      />,
    )

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/workflow name/i), {
      target: { value: 'Testing' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /create workflow/i }))

    await waitFor(() => {
      expect(within(dialog).getByText(/old server schema/i)).toBeDefined()
    })
    expect(within(dialog).queryByText(/^validation failed$/i)).toBeNull()
  })

  it('disables manual edge authoring and renders derived order edges', () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )
    expect(screen.getByTestId('react-flow-stub').getAttribute('data-connectable')).toBe('false')
    expect(screen.getByTestId('react-flow-stub').getAttribute('data-node-types')).toContain('agent')
    expect(screen.getByTestId('react-flow-stub').getAttribute('data-node-types')).toContain('appendStep')
    expect(screen.getByTestId('node-__trigger')).toBeDefined()
    expect(screen.getByTestId('node-__append')).toBeDefined()
    expect(screen.getByTestId('node-write').getAttribute('data-initial-size')).toBe('x')
    expect(screen.getByTestId('node-write').getAttribute('data-measured-size')).toBe('x')
    expect(screen.getByTestId('node-write').getAttribute('data-style-size')).toBe('280x120')
    expect(screen.getByTestId('edge-__trigger-write')).toBeDefined()
    expect(screen.getByTestId('edge-write-review')).toBeDefined()
    expect(screen.getByTestId('edge-review-__append')).toBeDefined()
  })

  it('passes assignee metadata through edit canvas nodes consistently', () => {
    const withAssignmentMetadata: WorkflowDefinition = {
      name: 'Publishing flow',
      description: 'Metadata rendering',
      version: 1,
      steps: [
        { id: 'write', type: 'agent', label: 'Write Copy', agent: '$assigned', task: 'Draft copy.' },
        { id: 'publish', type: 'output', label: 'Publish', agent: 'hugo', channels: ['general'] },
        {
          id: 'follow-up',
          type: 'createTask',
          label: 'Follow Up',
          title: 'Review published post',
          agent: 'jessica',
          column: 'todo',
          description: 'Check the published result.',
        },
      ],
      layout: {
        positions: {
          write: { x: 100, y: 50 },
          publish: { x: 100, y: 200 },
          'follow-up': { x: 100, y: 350 },
        },
      },
    }

    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="publishing-flow"
        initialDefinition={withAssignmentMetadata}
        source="user"
      />,
    )

    expect(nodeData('write').agent).toBe('$assigned')
    expect(nodeData('publish')).toMatchObject({
      agent: 'hugo',
      channels: ['general'],
    })
    expect(nodeData('follow-up')).toMatchObject({
      agent: 'jessica',
      title: 'Review published post',
      column: 'todo',
      description: 'Check the published result.',
    })
  })

  it('reopens the step palette when the edge insert affordance is clicked', () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    expect(screen.getByTestId('node-type-palette').getAttribute('data-collapsed')).toBe('false')
    fireEvent.click(screen.getByTestId('collapse-palette'))
    expect(screen.getByTestId('node-type-palette').getAttribute('data-collapsed')).toBe('true')
    fireEvent.click(screen.getByTestId('open-palette-__trigger-write'))
    expect(screen.getByTestId('node-type-palette').getAttribute('data-collapsed')).toBe('false')
  })

  it('renders nodes when the workflow definition arrives after mount', () => {
    const { rerender } = render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        source="user"
      />,
    )

    expect(screen.queryByTestId('node-write')).toBeNull()

    rerender(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    expect(screen.getByTestId('node-write')).toBeDefined()
    expect(screen.getByTestId('node-review')).toBeDefined()
    expect(screen.getByTestId('edge-write-review')).toBeDefined()
  })

  it('preserves declared fields the editor does not render on save', async () => {
    // Schemas are strict now — unknown keys reject at the CRUD boundary, so
    // the preservation contract covers declared-but-uneditable fields
    // (output_schema, deny_tools), not arbitrary YAML extensions.
    const withUnrendered = {
      ...sampleDefinition,
      steps: [
        {
          id: 'write',
          type: 'agent',
          label: 'Write',
          agent: 'chef',
          output_schema: { type: 'object', required: ['text'] },
          deny_tools: ['bakin_exec_git_push'],
        },
        {
          id: 'review',
          type: 'gate',
          label: 'Review',
        },
      ],
    } as unknown as WorkflowDefinition

    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={withUnrendered}
        source="user"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /auto-arrange/i }))
    fireEvent.click(getCanvasSaveButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition & Record<string, unknown>
    expect((body.steps[0] as unknown as Record<string, unknown>).output_schema).toEqual({ type: 'object', required: ['text'] })
    expect((body.steps[0] as unknown as Record<string, unknown>).deny_tools).toEqual(['bakin_exec_git_push'])
  })

  it('reorders the selected node and saves the new runtime order', async () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )
    fireEvent.click(screen.getByTestId('node-review'))
    expect(screen.getByTestId('node-review').getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId('node-review').getAttribute('data-class-name')).toContain('bakin-workflow-node-selected')
    fireEvent.click(screen.getByRole('button', { name: /move selected step up/i }))
    closeNodeDrawer()
    fireEvent.click(getCanvasSaveButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    expect(body.steps.map((step) => step.id)).toEqual(['review', 'write'])
  })

  it('deletes the selected node and keeps the saved workflow connected', async () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    fireEvent.click(screen.getByTestId('node-review'))
    fireEvent.click(screen.getByRole('button', { name: /delete selected step/i }))
    expect(screen.queryByTestId('node-review')).toBeNull()
    expect(screen.getByTestId('edge-__trigger-write')).toBeDefined()
    fireEvent.click(getCanvasSaveButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    expect(body.steps.map((step) => step.id)).toEqual(['write'])
  })

  it('defaults inserted agent steps to the assigned task agent token', async () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    fireEvent.click(screen.getByTestId('insert-__trigger-write'))
    closeNodeDrawer()
    fireEvent.click(getCanvasSaveButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    expect(body.steps[0]).toMatchObject({
      id: 'agent',
      type: 'agent',
      label: 'Agent Task',
      agent: '$assigned',
    })
  })

  it('opens the config drawer for a newly dropped step', () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    expect(screen.queryByTestId('node-config-drawer')).toBeNull()

    const dataTransfer = {
      types: ['application/x-bakin-node-kind', 'text/plain'],
      dropEffect: 'move',
      getData: mock((type: string) => (
        type === 'application/x-bakin-node-kind' || type === 'text/plain' ? 'agent' : ''
      )),
    }
    const canvas = screen.getByTestId('react-flow-stub')
    fireEvent.dragOver(canvas, { dataTransfer })
    fireEvent.drop(canvas, { dataTransfer })

    expect(screen.getByTestId('node-config-drawer').getAttribute('data-step-id')).toBe('agent')
    expect(screen.getByTestId('node-agent').getAttribute('data-selected')).toBe('true')
  })

  it('ignores drops that only provide text/plain data', () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    const dataTransfer = {
      types: ['text/plain'],
      dropEffect: 'move',
      getData: mock((type: string) => (type === 'text/plain' ? 'agent' : '')),
    }
    const canvas = screen.getByTestId('react-flow-stub')
    fireEvent.dragOver(canvas, { dataTransfer })
    fireEvent.drop(canvas, { dataTransfer })

    expect(screen.queryByTestId('node-agent')).toBeNull()
    expect(screen.queryByTestId('node-config-drawer')).toBeNull()
  })

  it('appends a step from the end-of-workflow target', async () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    fireEvent.click(screen.getByTestId('insert-review-__append'))
    expect(screen.getByTestId('node-config-drawer').getAttribute('data-step-id')).toBe('agent')

    closeNodeDrawer()
    fireEvent.click(getCanvasSaveButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    expect(body.steps.map((step) => step.id)).toEqual(['write', 'review', 'agent'])
  })

  it('disables completion when the workflow already has one and blocks duplicate insertion', async () => {
    const withCompletion: WorkflowDefinition = {
      ...sampleDefinition,
      steps: [
        ...sampleDefinition.steps,
        { id: 'publish', type: 'output', label: 'Publish', channels: ['general'] },
      ],
      layout: {
        positions: {
          ...sampleDefinition.layout!.positions!,
          publish: { x: 100, y: 350 },
        },
      },
    }

    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={withCompletion}
        source="user"
      />,
    )

    expect(screen.getByTestId('node-type-palette').getAttribute('data-disabled-kinds')).toBe('output')
    fireEvent.click(screen.getByTestId('insert-output-publish-__append'))
    expect(screen.queryByTestId('node-output')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /auto-arrange/i }))
    fireEvent.click(getCanvasSaveButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    expect(body.steps.filter((step) => step.type === 'output')).toHaveLength(1)
    expect(body.steps.map((step) => step.id)).toEqual(['write', 'review', 'publish'])
  })

  it('prompts before leaving with unsaved changes and can save before exit', async () => {
    const onCancel = mock()
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByTestId('insert-review-__append'))
    fireEvent.click(getEditorHeaderButton(/back to workflows/i))

    expect(onCancel).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Unsaved workflow changes')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: /save and exit/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(onCancel).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    expect(body.steps.map((step) => step.id)).toEqual(['write', 'review', 'agent'])
  })

  it('registers a router navigation blocker while the editor has unsaved changes', async () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    expect(latestHistoryBlock).toBeNull()
    fireEvent.click(screen.getByTestId('insert-review-__append'))
    await waitFor(() => expect(latestHistoryBlock).not.toBeNull())
    expect(latestHistoryBlock?.enableBeforeUnload).toBe(false)

    await expect(latestHistoryBlock!.blockerFn({
      action: 'REPLACE',
      currentLocation: { pathname: '/workflows/video-script/edit' },
      nextLocation: { pathname: '/workflows/video-script/edit' },
    })).resolves.toBe(false)

    let routeDecision!: Promise<boolean>
    await act(async () => {
      routeDecision = latestHistoryBlock!.blockerFn({
        action: 'PUSH',
        currentLocation: { pathname: '/workflows/video-script/edit' },
        nextLocation: { pathname: '/workflows' },
      })
    })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Unsaved workflow changes')).toBeDefined()
    let shouldBlockRoute = false
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
      shouldBlockRoute = await routeDecision
    })
    expect(shouldBlockRoute).toBe(true)
  })

  it('resolves a pending route blocker when a newly seeded workflow resets the guard', async () => {
    const { rerender } = render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )

    fireEvent.click(screen.getByTestId('insert-review-__append'))
    await waitFor(() => expect(latestHistoryBlock).not.toBeNull())

    let routeDecision!: Promise<boolean>
    await act(async () => {
      routeDecision = latestHistoryBlock!.blockerFn({
        action: 'PUSH',
        currentLocation: { pathname: '/workflows/video-script/edit' },
        nextLocation: { pathname: '/workflows' },
      })
    })
    expect(await screen.findByRole('dialog')).toBeDefined()

    rerender(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script-copy"
        initialDefinition={{ ...sampleDefinition, id: 'video-script-copy', name: 'Video Script Copy' }}
        source="user"
      />,
    )

    let shouldBlockRoute = false
    await act(async () => {
      shouldBlockRoute = await routeDecision
    })
    expect(shouldBlockRoute).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows a managed-workflow modal when editing a plugin-owned workflow', () => {
    const onCancel = mock()
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="plugin"
        onCancel={onCancel}
      />,
    )
    expect(screen.getByText('Managed workflow')).toBeDefined()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Edit managed workflow/)).toBeDefined()
    expect(within(dialog).getByText(/To edit this workflow, Bakin will create a custom copy/i)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: /back/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('uses a confirmation dialog before deleting a workflow', async () => {
    const onDeleted = mock()
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
        onDeleted={onDeleted}
      />,
    )

    fireEvent.click(getEditorHeaderButton(/workflow actions/i))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(fetchMock).not.toHaveBeenCalled()
    let dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete workflow?')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(getEditorHeaderButton(/workflow actions/i))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions/video-script')
    expect(init.method).toBe('DELETE')
    expect(onDeleted).toHaveBeenCalled()
  })

  it('creates a named custom copy and can disable the managed workflow', async () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={{ ...sampleDefinition, id: 'video-script' }}
        source="plugin"
      />,
    )

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /create copy/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as WorkflowDefinition & { id: string }
    expect(body.id).toBe('video-script-copy')
    expect(body.name).toBe('Video Script Copy')
    expect(body.steps.map((step) => step.id)).toEqual(['write', 'review'])

    const [availabilityUrl, availabilityInit] = fetchMock.mock.calls[1]
    expect(availabilityUrl).toBe('/api/plugins/workflows/definitions/video-script/availability')
    expect(availabilityInit.method).toBe('PATCH')
    expect(JSON.parse(availabilityInit.body as string)).toEqual({ disabled: true })

    await waitFor(() => expect(getCanvasSaveButton()).toBeDefined())
  })

  it('continues into the custom copy when disabling the managed workflow fails', async () => {
    const onCopied = mock()
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/plugins/workflows/definitions' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'video-script-copy', source: 'user' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url === '/api/plugins/workflows/definitions/video-script/availability' && init?.method === 'PATCH') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'availability unavailable' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: `unexpected ${url}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={{ ...sampleDefinition, id: 'video-script' }}
        source="plugin"
        onCopied={onCopied}
      />,
    )

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /create copy/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(onCopied).toHaveBeenCalledWith('video-script-copy')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the managed-workflow modal after navigating to a custom copy', () => {
    const { rerender } = render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="plugin"
      />,
    )

    expect(screen.getByRole('dialog')).toBeDefined()

    rerender(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script-copy"
        initialDefinition={{ ...sampleDefinition, id: 'video-script-copy', name: 'Video Script Copy' }}
        source="user"
      />,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('auto-arranges nodes when layout.positions is absent', async () => {
    const noLayout: WorkflowDefinition = {
      ...sampleDefinition,
      layout: undefined,
    }
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={noLayout}
        source="user"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /auto-arrange/i }))
    fireEvent.click(getCanvasSaveButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    // Dagre produces a top-to-bottom arrangement (rankdir: 'TB'); we only
    // assert that write is above review — the exact coordinates
    // depend on the layout engine's internals.
    const write = body.layout?.positions?.write
    const review = body.layout?.positions?.review
    expect(write).toBeDefined()
    expect(review).toBeDefined()
    expect(write!.y).toBeLessThan(review!.y)
  })
})
