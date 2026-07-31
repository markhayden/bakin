// @vitest-environment jsdom

import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { NavList } from '@makinbakin/sdk/patterns'
import '../../rtl-settle'

describe('NavList', () => {
  it('renders a labeled nav of buttons and announces the selection with aria-current', () => {
    const onSelect = mock(() => {})
    render(
      <NavList
        label="Plugin settings"
        selectedId="schedule"
        onSelect={onSelect}
        items={[
          { id: 'tasks', label: 'Tasks' },
          { id: 'schedule', label: 'Schedule' },
          { id: 'health', label: 'Health' },
        ]}
      />,
    )

    const nav = screen.getByRole('navigation', { name: 'Plugin settings' })
    expect(nav.getAttribute('data-nav-list')).toBe('')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)

    const selected = screen.getByRole('button', { name: 'Schedule' })
    expect(selected.getAttribute('aria-current')).toBe('true')
    expect(selected.getAttribute('data-selected')).toBe('')
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Health' }))
    expect(onSelect).toHaveBeenCalledWith('health')
  })

  it('renders section headings, leading identity, meta, description, and disabled state', () => {
    render(
      <NavList
        label="Installed skills"
        selectedId={null}
        onSelect={() => {}}
        sections={[
          {
            label: 'Core',
            items: [
              {
                id: 'research',
                label: 'Research',
                leading: <span data-testid="leading-icon" />,
                meta: <span>Guide</span>,
                description: 'Web research with citation discipline.',
              },
            ],
          },
          {
            label: 'Extensions',
            items: [{ id: 'archived', label: 'Archived', disabled: true }],
          },
        ]}
      />,
    )

    expect(screen.getByText('Core')).toBeDefined()
    expect(screen.getByText('Extensions')).toBeDefined()
    expect(screen.getByTestId('leading-icon')).toBeDefined()
    expect(screen.getByText('Guide')).toBeDefined()
    expect(screen.getByText('Web research with citation discipline.')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Archived' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('moves focus with ArrowUp/ArrowDown/Home/End across sections, skipping disabled items', () => {
    render(
      <NavList
        label="Installed skills"
        selectedId="alpha"
        onSelect={() => {}}
        sections={[
          {
            label: 'Core',
            items: [
              { id: 'alpha', label: 'Alpha' },
              { id: 'beta', label: 'Beta', disabled: true },
            ],
          },
          { label: 'Extensions', items: [{ id: 'gamma', label: 'Gamma' }] },
        ]}
      />,
    )

    const alpha = screen.getByRole('button', { name: 'Alpha' })
    const gamma = screen.getByRole('button', { name: 'Gamma' })

    alpha.focus()
    // Skips the disabled Beta and crosses the section boundary.
    fireEvent.keyDown(alpha, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(gamma)

    // Wraps from the last item back to the first.
    fireEvent.keyDown(gamma, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(alpha)

    fireEvent.keyDown(alpha, { key: 'End' })
    expect(document.activeElement).toBe(gamma)
    fireEvent.keyDown(gamma, { key: 'Home' })
    expect(document.activeElement).toBe(alpha)

    // Focus movement never changes the selection.
    expect(alpha.getAttribute('aria-current')).toBe('true')
    expect(gamma.getAttribute('aria-current')).toBeNull()
  })
})
