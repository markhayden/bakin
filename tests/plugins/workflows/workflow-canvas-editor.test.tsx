// @vitest-environment jsdom

/**
 * Smoke test for `plugins/workflows/components/workflow-canvas-editor.tsx`.
 *
 * Scope (T9 scaffold): loading a definition, saving back via PUT, and
 * verifying that layout.positions is included in the save payload. The
 * xyflow ReactFlow component is stubbed out — we don't exercise its
 * internals here, just the wiring layer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-canvas-editor-${Date.now()}`)

// CLAUDE.md — content-dir mock even for pure UI tests.
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
  readTaskboard: vi.fn(() => ({ columns: {} })),
  getTask: vi.fn(() => null),
  getTaskWithColumn: vi.fn(() => null),
}))

// Stub xyflow so we render in jsdom without pulling its real DOM layer.
// The scaffold we're testing only cares about the Save button in the
// toolbar — `nodes` / `edges` plumbing is ReactFlow's problem once the
// library is loaded, not ours.
vi.mock('@xyflow/react', () => ({
  __esModule: true,
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow-stub">{children}</div>
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MiniMap: () => null,
  applyNodeChanges: (_c: unknown, nds: unknown) => nds,
  applyEdgeChanges: (_c: unknown, eds: unknown) => eds,
}))

// Side-effect import guard — plugin-manifest pulls in lots of plugins.
// Stubbed to a no-op so the canvas editor can import it safely.
vi.mock('@/lib/plugin-manifest', () => ({
  allNavItems: [],
}))

// Stub palette + drawer — they have their own dedicated tests. Keeps
// canvas-editor tests focused on the save pipeline.
vi.mock('../../../plugins/workflows/components/node-type-palette', () => ({
  NodeTypePalette: () => null,
  PALETTE_DRAG_MIME_TYPE: 'application/x-bakin-node-kind',
}))
vi.mock('../../../plugins/workflows/components/node-config-drawer', () => ({
  NodeConfigDrawer: () => null,
}))

// Imported AFTER mocks.
import { WorkflowCanvasEditor } from '../../../plugins/workflows/components/workflow-canvas-editor'
import type { WorkflowDefinition } from '../../../plugins/workflows/types'

const sampleDefinition: WorkflowDefinition = {
  name: 'Video Script',
  description: 'Write a script',
  version: 1,
  steps: [
    { id: 'write', type: 'agent', label: 'Write', agent: 'basil' },
    { id: 'review', type: 'gate', label: 'Review', on_approve: 'done' },
  ],
  layout: {
    positions: {
      write: { x: 100, y: 50 },
      review: { x: 100, y: 200 },
    },
  },
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

describe('WorkflowCanvasEditor', () => {
  it('renders the toolbar with the workflow id in edit mode', () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="user"
      />,
    )
    expect(screen.getByText(/Edit · video-script/)).toBeDefined()
    expect(screen.getByRole('button', { name: /save/i })).toBeDefined()
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
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/plugins/workflows/definitions/video-script')
    expect(init.method).toBe('PUT')

    const body = JSON.parse(init.body as string) as WorkflowDefinition
    expect(body.name).toBe('Video Script')
    expect(body.layout?.positions?.write).toEqual({ x: 100, y: 50 })
    expect(body.layout?.positions?.review).toEqual({ x: 100, y: 200 })
  })

  it('shows plugin-owned hint when source is "plugin"', () => {
    render(
      <WorkflowCanvasEditor
        mode="edit"
        initialId="video-script"
        initialDefinition={sampleDefinition}
        source="plugin"
      />,
    )
    expect(screen.getByText(/plugin-owned/)).toBeDefined()
  })

  it('falls back to default positions when layout.positions is absent', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    // Stacked default: step 0 at y=0, step 1 at y=130
    expect(body.layout?.positions?.write).toEqual({ x: 0, y: 0 })
    expect(body.layout?.positions?.review).toEqual({ x: 0, y: 130 })
  })
})
