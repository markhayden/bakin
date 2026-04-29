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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-canvas-editor-${Date.now()}`)

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
mock.module('@/core/task-store', () => ({
  createTask: mock(),
  addTaskLog: mock(),
  moveTask: mock(),
  readTaskboard: mock(() => ({ columns: {} })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

// Stub xyflow so we render in jsdom without pulling its real DOM layer.
// The scaffold we're testing only cares about the Save button in the
// toolbar — `nodes` / `edges` plumbing is ReactFlow's problem once the
// library is loaded, not ours.
mock.module('@xyflow/react', () => ({
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

// Stub palette + drawer — they have their own dedicated tests. Keeps
// canvas-editor tests focused on the save pipeline.
mock.module('../../../plugins/workflows/components/node-type-palette', () => ({
  NodeTypePalette: () => null,
  PALETTE_DRAG_MIME_TYPE: 'application/x-bakin-node-kind',
}))
mock.module('../../../plugins/workflows/components/node-config-drawer', () => ({
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

let fetchMock: ReturnType<typeof mock>

beforeEach(() => {
  fetchMock = mock(() =>
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
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string) as WorkflowDefinition
    // Dagre produces a left-to-right arrangement (rankdir: 'LR'); we only
    // assert that write is to the left of review — the exact coordinates
    // depend on the layout engine's internals.
    const write = body.layout?.positions?.write
    const review = body.layout?.positions?.review
    expect(write).toBeDefined()
    expect(review).toBeDefined()
    expect(write!.x).toBeLessThan(review!.x)
  })
})
