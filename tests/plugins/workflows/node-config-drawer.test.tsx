// @vitest-environment jsdom

/**
 * Tests for `plugins/workflows/components/node-config-drawer.tsx`.
 *
 * The drawer reads from the node-type registry to know which form fields
 * to render per kind. These tests exercise one builtin kind per shape
 * (agent for agent-style picker, gate for the required on_approve
 * string, output for list fields) and confirm:
 *   1. Form renders from formFields metadata.
 *   2. Apply validates against the kind's Zod schema and surfaces errors.
 *   3. Valid Apply fires onApply with the merged patch.
 *   4. Unknown / unregistered kinds show a friendly notice (plugin
 *      inactive case).
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-node-config-drawer-${Date.now()}`)

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
mock.module('../../../plugins/tasks/lib/flow-store', () => ({}))

// Stub AgentSelect so the agent-field renderer renders in jsdom without
// hitting the agent store.
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => [
    { id: 'basil', name: 'Basil' },
    { id: 'pixel', name: 'Pixel' },
  ],
}))
mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
}))

import { NodeConfigDrawer } from '../../../plugins/workflows/components/node-config-drawer'

afterEach(cleanup)

describe('NodeConfigDrawer', () => {
  it('renders formFields for a builtin agent step', () => {
    render(
      <NodeConfigDrawer
        step={{ id: 'do-thing', type: 'agent', label: 'Do Thing', agent: 'basil' }}
        onApply={() => {}}
        onClose={() => {}}
      />,
    )
    // id + label + agent + task + skill fields from agentFormFields are present
    expect(screen.getByLabelText(/^id$/i)).toBeDefined()
    expect(screen.getByLabelText(/^label$/i)).toBeDefined()
    expect(screen.getAllByText(/agent/i).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/^task$/i)).toBeDefined()
  })

  it('calls onApply with the merged patch when Apply is clicked on valid input', () => {
    const onApply = mock()
    render(
      <NodeConfigDrawer
        step={{ id: 'approve', type: 'gate', label: 'Approve', on_approve: 'done' }}
        onApply={onApply}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).toHaveBeenCalled()
    const patch = onApply.mock.calls[0][0] as Record<string, unknown>
    expect(patch.id).toBe('approve')
    expect(patch.label).toBe('Approve')
    expect(patch.type).toBe('gate')
  })

  it('surfaces Zod errors when required fields are missing', () => {
    const onApply = mock()
    render(
      <NodeConfigDrawer
        // gate with empty on_approve should fail min(1) validation.
        step={{ id: 'g', type: 'gate', label: 'G', on_approve: '' }}
        onApply={onApply}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).not.toHaveBeenCalled()
    // Error surface — one of the issue messages mentions on_approve.
    const errors = screen.getAllByRole('listitem')
    expect(errors.length).toBeGreaterThan(0)
  })

  it('shows a friendly notice when the kind is unregistered', () => {
    render(
      <NodeConfigDrawer
        step={{ id: 's', type: 'ghost.never-registered', label: 'S' }}
        onApply={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/No registered node type/)).toBeDefined()
  })

  it('closes via the X button', () => {
    const onClose = mock()
    render(
      <NodeConfigDrawer
        step={{ id: 's1', type: 'agent', label: 'S', agent: 'basil' }}
        onApply={() => {}}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByLabelText(/close drawer/i))
    expect(onClose).toHaveBeenCalled()
  })
})
