// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children, onClick, title, disabled, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} title={title as string} disabled={disabled as boolean} {...props}>
      {children as React.ReactNode}
    </button>
  ),
}))

mock.module('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: Record<string, unknown>) => (
    <span data-testid="badge" {...props}>{children as React.ReactNode}</span>
  ),
}))

mock.module('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input data-testid="rejection-input" {...props} />,
}))

import { ProposalCard } from '../../../plugins/messaging/components/proposal-card'
import type { ProposedItem } from '../../../plugins/messaging/types'

afterEach(() => cleanup())

function makeProposal(overrides: Partial<ProposedItem> = {}): ProposedItem {
  return {
    id: 'p1',
    messageId: 'm1',
    revision: 1,
    agentId: 'chef',
    title: 'Monday Recipe',
    scheduledAt: '2026-04-13T10:00:00Z',
    contentType: 'recipe',
    tone: 'energetic',
    brief: 'A quick pasta dish for busy weeknights',
    status: 'proposed',
    ...overrides,
  }
}

describe('ProposalCard', () => {
  it('renders title, date, type, and tone', () => {
    render(<ProposalCard proposal={makeProposal()} />)
    expect(screen.getByText('Monday Recipe')).toBeDefined()
    expect(screen.getByText('recipe')).toBeDefined()
    expect(screen.getByText('energetic')).toBeDefined()
    expect(screen.getByText(/busy weeknights/)).toBeDefined()
  })

  it('shows Proposed status chip for proposed items', () => {
    render(<ProposalCard proposal={makeProposal()} />)
    expect(screen.getByText('Proposed')).toBeDefined()
  })

  it('shows Approved status chip for approved items', () => {
    render(<ProposalCard proposal={makeProposal({ status: 'approved' })} />)
    expect(screen.getByText('Approved')).toBeDefined()
  })

  it('shows Rejected status chip with rejection note', () => {
    render(
      <ProposalCard
        proposal={makeProposal({
          status: 'rejected',
          rejectionNote: 'Too similar to last week',
        })}
      />
    )
    expect(screen.getByText('Rejected')).toBeDefined()
    expect(screen.getByText(/Too similar to last week/)).toBeDefined()
  })

  it('shows approve/reject/edit buttons for proposed items', () => {
    const onApprove = mock()
    const onReject = mock()
    const onEdit = mock()
    render(
      <ProposalCard
        proposal={makeProposal()}
        onApprove={onApprove}
        onReject={onReject}
        onEdit={onEdit}
      />
    )
    expect(screen.getByTitle('Approve')).toBeDefined()
    expect(screen.getByTitle('Reject')).toBeDefined()
    expect(screen.getByTitle('Edit')).toBeDefined()
  })

  it('hides action buttons for approved items', () => {
    render(<ProposalCard proposal={makeProposal({ status: 'approved' })} />)
    expect(screen.queryByTitle('Approve')).toBeNull()
    expect(screen.queryByTitle('Reject')).toBeNull()
  })

  it('calls onApprove with proposal id', () => {
    const onApprove = mock()
    render(<ProposalCard proposal={makeProposal()} onApprove={onApprove} />)
    fireEvent.click(screen.getByTitle('Approve'))
    expect(onApprove).toHaveBeenCalledWith('p1')
  })

  it('shows rejection note input on reject click', () => {
    const onReject = mock()
    render(<ProposalCard proposal={makeProposal()} onReject={onReject} />)
    fireEvent.click(screen.getByTitle('Reject'))
    expect(screen.getByTestId('rejection-input')).toBeDefined()
  })

  it('renders channel badges', () => {
    render(
      <ProposalCard
        proposal={makeProposal({ channels: ['discord', 'instagram'] })}
      />
    )
    expect(screen.getByText('discord')).toBeDefined()
    expect(screen.getByText('instagram')).toBeDefined()
  })

  it('shows Revised status chip for revised items with action buttons', () => {
    render(<ProposalCard proposal={makeProposal({ status: 'revised' })} onApprove={mock()} />)
    expect(screen.getByText('Revised')).toBeDefined()
    expect(screen.getByTitle('Approve')).toBeDefined()
  })
})
