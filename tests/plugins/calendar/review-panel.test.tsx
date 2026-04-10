// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, onClick, ...props }: Record<string, unknown>) => (
    <button disabled={disabled as boolean} onClick={onClick as () => void} {...props}>
      {children as React.ReactNode}
    </button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: Record<string, unknown>) => (
    <span data-testid="badge" {...props}>{children as React.ReactNode}</span>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}))

vi.mock('lucide-react', () => ({
  Check: () => <span />,
  X: () => <span />,
  Pencil: () => <span />,
  CheckCircle: () => <span data-testid="check-circle" />,
  Loader2: () => <span data-testid="loader" />,
}))

vi.mock('@/components/agent-avatar', () => ({
  AgentAvatar: () => <span />,
}))

import { ReviewPanel } from '../../../plugins/calendar/components/review-panel'
import type { ProposedItem } from '../../../plugins/calendar/types'

afterEach(() => cleanup())

function makeProposal(overrides: Partial<ProposedItem> = {}): ProposedItem {
  return {
    id: 'p1',
    messageId: 'm1',
    revision: 1,
    agentId: 'chef',
    title: 'Test Item',
    scheduledAt: '2026-04-13T10:00:00Z',
    contentType: 'recipe',
    tone: 'energetic',
    brief: 'Test brief',
    status: 'proposed',
    ...overrides,
  }
}

describe('ReviewPanel', () => {
  it('shows empty state when no proposals', () => {
    render(<ReviewPanel sessionId="s1" proposals={[]} />)
    expect(screen.getByText('No proposals yet')).toBeDefined()
  })

  it('renders proposals grouped by date', () => {
    const proposals = [
      makeProposal({ id: 'p1', scheduledAt: '2026-04-13T10:00:00Z', title: 'Monday Item' }),
      makeProposal({ id: 'p2', scheduledAt: '2026-04-15T10:00:00Z', title: 'Wednesday Item' }),
    ]
    render(<ReviewPanel sessionId="s1" proposals={proposals} />)
    expect(screen.getByText('Monday Item')).toBeDefined()
    expect(screen.getByText('Wednesday Item')).toBeDefined()
  })

  it('shows approved count in header', () => {
    const proposals = [
      makeProposal({ id: 'p1', status: 'approved' }),
      makeProposal({ id: 'p2', status: 'proposed' }),
      makeProposal({ id: 'p3', status: 'rejected' }),
    ]
    render(<ReviewPanel sessionId="s1" proposals={proposals} />)
    expect(screen.getByText('1/3 approved')).toBeDefined()
  })

  it('shows confirm button with approved count', () => {
    const proposals = [
      makeProposal({ id: 'p1', status: 'approved' }),
      makeProposal({ id: 'p2', status: 'approved' }),
    ]
    render(<ReviewPanel sessionId="s1" proposals={proposals} />)
    expect(screen.getByText('Confirm Plan (2 items)')).toBeDefined()
  })

  it('disables confirm button when no approvals', () => {
    const proposals = [makeProposal({ status: 'proposed' })]
    render(<ReviewPanel sessionId="s1" proposals={proposals} />)
    const confirmBtn = screen.getByText('Confirm Plan (0 items)').closest('button')
    expect(confirmBtn?.disabled).toBe(true)
  })

  it('shows confirmed badge for completed sessions', () => {
    const proposals = [makeProposal({ status: 'approved' })]
    render(<ReviewPanel sessionId="s1" proposals={proposals} isCompleted={true} />)
    expect(screen.getByText(/Plan confirmed/)).toBeDefined()
  })

  it('hides confirm button for completed sessions', () => {
    const proposals = [makeProposal({ status: 'approved' })]
    render(<ReviewPanel sessionId="s1" proposals={proposals} isCompleted={true} />)
    expect(screen.queryByText(/Confirm Plan/)).toBeNull()
  })
})
