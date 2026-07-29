// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/components', () => ({
  AgentAvatar: ({ agentId, size }: { agentId: string; size: string }) => (
    <span data-testid={`agent-${agentId}`} data-size={size}>{agentId}</span>
  ),
}))

import { WorkflowCard } from '../../../plugins/workflows/components/workflow-card'

afterEach(cleanup)

describe('WorkflowCard', () => {
  it('keeps scan signals on the card and reveals the complete sequence from a dedicated info control', async () => {
    const user = userEvent.setup()
    render(
      <WorkflowCard
        onClick={() => {}}
        template={{
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
        }}
      />,
    )

    expect(screen.getByText('Task agent')).toBeDefined()
    expect(screen.queryByTestId('agent-$assigned')).toBeNull()
    expect(screen.getByTestId('agent-pixel').getAttribute('data-size')).toBe('sm')
    expect(screen.getByText('Human approval')).toBeDefined()
    expect(screen.getByText('Nested workflow')).toBeDefined()
    expect(screen.queryByText(/Gate · Review/i)).toBeNull()

    expect(screen.getByText('4 steps')).toBeDefined()
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
      <WorkflowCard
        onClick={onClick}
        template={{
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
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: 'Show 2 workflow steps',
    }))
    expect(onClick).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', {
      name: 'Open Approval flow',
    }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows managed workflow provenance as an icon before the step count', () => {
    render(
      <WorkflowCard
        onClick={() => {}}
        template={{
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
        }}
      />,
    )

    const footer = screen.getByTestId('workflow-card-footer-meta')
    const managedIcon = within(footer).getByLabelText(
      'Managed by workflows plugin; read-only',
    )
    const stepCount = within(footer).getByText('1 step')
    const stepInfo = within(footer).getByRole('button', {
      name: 'Show 1 workflow step',
    })

    expect(managedIcon.compareDocumentPosition(stepCount) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(stepCount.compareDocumentPosition(stepInfo) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(within(footer).queryByText('workflows')).toBeNull()
  })
})
