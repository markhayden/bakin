// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { StatGroup, StatTile, StatusBadge } from '@makinbakin/sdk/patterns'

afterEach(cleanup)

function StubIcon({ className }: { className?: string }) {
  return <svg data-testid="status-icon" className={className}><title>Decorative icon</title></svg>
}

describe('status and metric patterns', () => {
  it('keeps a visible status label while treating optional iconography as supplemental', () => {
    render(<StatusBadge tone="attention" icon={StubIcon}>Needs review</StatusBadge>)

    const badge = screen.getByText('Needs review').closest('[data-status-badge]')
    expect(badge?.getAttribute('data-status-badge')).toBe('attention')
    expect(badge?.getAttribute('data-tone')).toBe('attention')
    expect(badge?.getAttribute('data-variant')).toBe('solid')
    expect(screen.getByTestId('status-icon').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('uses the low-chrome metric treatment by default and exposes exact progress', () => {
    render(
      <StatTile
        label="Migration coverage"
        value="128 / 140"
        valueTone="attention"
        sub="12 surfaces remain"
        progress={{ percent: 91.428, tone: 'attention', label: 'Migration coverage' }}
      />,
    )

    const tile = document.querySelector<HTMLElement>('[data-stat-tile]')
    expect(tile?.getAttribute('data-variant')).toBe('plain')
    expect(tile?.getAttribute('data-value-tone')).toBe('attention')
    expect(screen.getByText('128 / 140')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Migration coverage' }).getAttribute('aria-valuenow')).toBe('91.428')
  })

  it('packs compact peer metrics from the start edge and wraps as a group', () => {
    const { container } = render(
      <StatGroup label="Task summary metrics">
        <StatTile label="Active" value={4} />
        <StatTile label="Blocked" value={23} valueTone="danger" />
        <StatTile label="Done today" value={0} valueTone="success" />
      </StatGroup>,
    )

    const group = screen.getByRole('group', { name: 'Task summary metrics' })
    expect(group.getAttribute('data-stat-group')).toBe('')
    expect(group.className).toContain('flex-wrap')
    expect(group.className).toContain('justify-start')
    expect(container.querySelectorAll('[data-stat-tile]')).toHaveLength(3)
  })

  it('clamps progress and makes actionable surface metrics native buttons', () => {
    const onClick = mock()
    render(
      <StatTile
        label="Blocked tasks"
        value={3}
        variant="surface"
        progress={{ percent: 140, tone: 'danger' }}
        onClick={onClick}
      />,
    )

    const button = screen.getByRole('button', { name: /Blocked tasks 3/ })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('data-variant')).toBe('surface')
    expect(screen.getByRole('progressbar', { name: 'Blocked tasks progress' }).getAttribute('aria-valuenow')).toBe('100')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
