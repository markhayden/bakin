// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} disabled={disabled as boolean} {...props}>
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
  Input: ({ value, onChange, onBlur, onKeyDown, ...props }: Record<string, unknown>) => (
    <input
      value={value as string}
      onChange={onChange as () => void}
      onBlur={onBlur as () => void}
      onKeyDown={onKeyDown as () => void}
      {...props}
    />
  ),
}))

import { ProposalCard } from '../../../plugins/messaging/components/proposal-card'
import type { ProposedItem } from '../../../plugins/messaging/types'

afterEach(() => cleanup())

function makeProposal(overrides: Partial<ProposedItem> = {}): ProposedItem {
  return {
    id: 'p1',
    messageId: 'm1',
    revision: 1,
    agentId: 'basil',
    title: 'Monday Recipe',
    scheduledAt: '2026-04-13T10:00:00Z',
    contentType: 'recipe',
    tone: 'energetic',
    brief: 'A quick pasta dish',
    status: 'proposed',
    ...overrides,
  }
}

describe('Inline title editing', () => {
  it('shows title as text by default', () => {
    render(
      <ProposalCard
        proposal={makeProposal()}
        onTitleChange={mock()}
      />
    )
    expect(screen.getByTestId('proposal-title')).toBeDefined()
    expect(screen.getByText('Monday Recipe')).toBeDefined()
    expect(screen.queryByTestId('title-input')).toBeNull()
  })

  it('switches to input on title click', () => {
    render(
      <ProposalCard
        proposal={makeProposal()}
        onTitleChange={mock()}
      />
    )
    fireEvent.click(screen.getByTestId('proposal-title'))
    expect(screen.getByTestId('title-input')).toBeDefined()
  })

  it('calls onTitleChange on Enter', () => {
    const onTitleChange = mock()
    render(
      <ProposalCard
        proposal={makeProposal()}
        onTitleChange={onTitleChange}
      />
    )
    fireEvent.click(screen.getByTestId('proposal-title'))
    const input = screen.getByTestId('title-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated Title' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onTitleChange).toHaveBeenCalledWith('p1', 'Updated Title')
  })

  it('cancels on Escape without calling callback', () => {
    const onTitleChange = mock()
    render(
      <ProposalCard
        proposal={makeProposal()}
        onTitleChange={onTitleChange}
      />
    )
    fireEvent.click(screen.getByTestId('proposal-title'))
    const input = screen.getByTestId('title-input')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onTitleChange).not.toHaveBeenCalled()
    // Should be back to text
    expect(screen.getByTestId('proposal-title')).toBeDefined()
  })

  it('does not show editable title for approved proposals', () => {
    render(
      <ProposalCard
        proposal={makeProposal({ status: 'approved' })}
        onTitleChange={mock()}
      />
    )
    const title = screen.getByTestId('proposal-title')
    fireEvent.click(title)
    // Should NOT switch to input since canAct is false for approved
    expect(screen.queryByTestId('title-input')).toBeNull()
  })

  it('does not show editable title without onTitleChange', () => {
    render(<ProposalCard proposal={makeProposal()} />)
    const title = screen.getByTestId('proposal-title')
    fireEvent.click(title)
    expect(screen.queryByTestId('title-input')).toBeNull()
  })
})
