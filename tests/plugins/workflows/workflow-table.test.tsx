// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../rtl-settle'

mock.module('../../../plugins/workflows/components/workflow-agent-identity', () => ({
  WorkflowAgentAvatar: ({ agentId, size }: { agentId: string; size: string }) => (
    <span data-testid={`agent-${agentId}`} data-size={size}>{agentId}</span>
  ),
}))

import { WorkflowTable } from '../../../plugins/workflows/components/workflow-table'

afterEach(cleanup)

describe('WorkflowTable', () => {
  it('shows one soft count and no preview control when there are no steps', () => {
    render(
      <WorkflowTable
        label="Workflows"
        onOpen={() => {}}
        templates={[{
          filename: 'empty-flow',
          name: 'Empty flow',
          description: '',
          stepCount: 0,
          definition: { name: 'Empty flow', description: '', version: 1, steps: [] },
        }]}
      />,
    )

    const cell = screen.getByTestId('workflow-row-meta')
    expect(within(cell).getAllByText('0 steps')).toHaveLength(1)
    expect(within(cell).getByText('0 steps').getAttribute('data-variant')).toBe('soft')
    expect(within(cell).queryByRole('button')).toBeNull()
  })

  it('keeps scan signals on the row and reveals the complete sequence from a dedicated info control', async () => {
    const user = userEvent.setup()
    render(
      <WorkflowTable
        label="Workflows"
        onOpen={() => {}}
        templates={[{
          filename: 'approval-flow',
          name: 'Approval flow',
          description: 'Draft, review, and publish.',
          source: 'user',
          stepCount: 4,
          definition: {
            name: 'Approval flow',
            description: 'Draft, review, and publish.',
            version: 1,
            steps: [
              { id: 'draft', type: 'agent', label: 'Draft', agent: '$assigned' },
              { id: 'review', type: 'gate', label: 'Review' },
              {
                id: 'polish',
                type: 'workflow',
                label: 'Polish',
                workflow_id: 'image-polish',
              },
              { id: 'publish', type: 'output', label: 'Publish', agent: 'pixel' },
            ],
          },
        }]}
      />,
    )

    expect(screen.getByText('Task agent')).toBeDefined()
    expect(screen.queryByTestId('agent-$assigned')).toBeNull()
    expect(screen.getByTestId('agent-pixel').getAttribute('data-size')).toBe('sm')
    expect(screen.getByText('Human approval')).toBeDefined()
    expect(screen.getByText('Nested workflow')).toBeDefined()
    expect(screen.queryByText(/Gate · Review/i)).toBeNull()

    expect(screen.getByText('4 steps')).toBeDefined()
    expect(screen.getByText('4 steps').getAttribute('data-variant')).toBe('soft')
    const stepInfo = screen.getByRole('button', {
      name: 'Show 4 workflow steps',
    })
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(stepInfo)

    await waitFor(() => {
      const tooltip = screen.getByRole('tooltip')
      expect(within(tooltip).getByText('Draft')).toBeDefined()
      expect(within(tooltip).getByText(/Gate · Review/i)).toBeDefined()
      expect(within(tooltip).getByText(/Nested · Image polish/i)).toBeDefined()
      expect(within(tooltip).getByText('Publish')).toBeDefined()
    })
  })

  it('keeps opening the workflow separate from the step info trigger', () => {
    const onClick = mock(() => {})
    render(
      <WorkflowTable
        label="Workflows"
        onOpen={onClick}
        templates={[{
          filename: 'approval-flow',
          name: 'Approval flow',
          description: 'Draft, review, and publish.',
          source: 'user',
          stepCount: 2,
          definition: {
            name: 'Approval flow',
            description: 'Draft, review, and publish.',
            version: 1,
            steps: [
              { id: 'draft', type: 'agent', label: 'Draft', agent: '$assigned' },
              { id: 'review', type: 'gate', label: 'Review' },
            ],
          },
        }]}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: 'Show 2 workflow steps',
    }))
    expect(onClick).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('row', {
      name: 'Open Approval flow',
    }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith('approval-flow')
    fireEvent.keyDown(screen.getByRole('row', { name: 'Open Approval flow' }), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('shows managed workflow provenance in Source, separate from the step count', () => {
    render(
      <WorkflowTable
        label="Workflows"
        onOpen={() => {}}
        templates={[{
          filename: 'managed-flow',
          name: 'Managed flow',
          description: 'Managed by the workflows plugin.',
          source: 'plugin',
          pluginId: 'workflows',
          stepCount: 1,
          definition: {
            name: 'Managed flow',
            description: 'Managed by the workflows plugin.',
            version: 1,
            steps: [
              { id: 'draft', type: 'agent', label: 'Draft', agent: '$assigned' },
            ],
          },
        }]}
      />,
    )

    const footer = screen.getByTestId('workflow-row-meta')
    const managedIcon = screen.getByLabelText(
      'Managed by workflows plugin; read-only',
    )
    expect(managedIcon.closest('td')).not.toBe(footer.closest('td'))
    expect(within(managedIcon.closest('td')!).getByText('Managed').getAttribute('data-variant')).toBe('soft')
    const stepCount = within(footer).getByText('1 step')
    const stepInfo = within(footer).getByRole('button', {
      name: 'Show 1 workflow step',
    })

    expect(managedIcon.compareDocumentPosition(stepCount) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(stepCount.compareDocumentPosition(stepInfo) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(within(footer).queryByText('workflows')).toBeNull()
  })
})
