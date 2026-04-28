// @vitest-environment jsdom

/**
 * Tests for `plugins/workflows/components/node-type-palette.tsx`.
 *
 * Covers:
 *  1. Groups node types into "Builtin" and "Plugins" sections.
 *  2. Plugin entries show the pluginId badge.
 *  3. onDragStart on a palette item populates the drag MIME type with
 *     the namespaced kind (so the canvas drop handler can create the
 *     new node).
 *  4. Collapse/expand toggles visibility.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-node-palette-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@/core/task-store', () => ({}))

import {
  NodeTypePalette,
  PALETTE_DRAG_MIME_TYPE,
  type PaletteNodeType,
} from '../../../plugins/workflows/components/node-type-palette'

const FIXTURES: PaletteNodeType[] = [
  { kind: 'agent', runtime: 'builtin', formFields: [] },
  { kind: 'gate', runtime: 'builtin', formFields: [] },
  { kind: 'fx.noise-gate', runtime: 'plugin', pluginId: 'fx', formFields: [] },
]

afterEach(cleanup)

describe('NodeTypePalette', () => {
  it('renders Builtin and Plugins groups from initialNodeTypes', () => {
    render(<NodeTypePalette initialNodeTypes={FIXTURES} />)
    expect(screen.getByText('Builtin')).toBeDefined()
    expect(screen.getByText('Plugins')).toBeDefined()
    expect(screen.getByText('agent')).toBeDefined()
    expect(screen.getByText('gate')).toBeDefined()
    // Plugin display strips the prefix; the pluginId appears as a badge.
    expect(screen.getByText('noise-gate')).toBeDefined()
    expect(screen.getByText('fx')).toBeDefined()
  })

  it('sets the drag MIME payload to the namespaced kind on dragstart', () => {
    const onDragKind = mock()
    render(<NodeTypePalette initialNodeTypes={FIXTURES} onDragKind={onDragKind} />)

    const item = screen.getByText('noise-gate').closest('li')!
    const setData = mock()
    fireEvent.dragStart(item, {
      dataTransfer: { setData, effectAllowed: '' },
    })

    expect(setData).toHaveBeenCalledWith(PALETTE_DRAG_MIME_TYPE, 'fx.noise-gate')
    expect(setData).toHaveBeenCalledWith('text/plain', 'fx.noise-gate')
    expect(onDragKind).toHaveBeenCalledWith('fx.noise-gate')
  })

  it('collapses and re-expands on chevron click', () => {
    render(<NodeTypePalette initialNodeTypes={FIXTURES} />)
    fireEvent.click(screen.getByLabelText(/collapse palette/i))
    expect(screen.queryByText('Builtin')).toBeNull()
    fireEvent.click(screen.getByLabelText(/expand palette/i))
    expect(screen.getByText('Builtin')).toBeDefined()
  })

  it('hydrates from GET /node-types when initialNodeTypes is omitted', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ nodeTypes: FIXTURES }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<NodeTypePalette />)
    // Wait a tick for fetch resolution.
    await screen.findByText('agent')
    expect(fetchMock).toHaveBeenCalledWith('/api/plugins/workflows/node-types')

    vi.unstubAllGlobals()
  })
})
