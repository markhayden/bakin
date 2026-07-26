// @vitest-environment jsdom

import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { PageNavigator } from '../../../plugins/team/components/page-navigator'

describe('PageNavigator', () => {
  it('moves between bounded pages and exposes an explicit show-all mode', () => {
    const onPageChange = mock(() => {})
    const onShowAllChange = mock(() => {})

    const { rerender } = render(
      <PageNavigator
        page={1}
        pageSize={10}
        showAll={false}
        total={24}
        onPageChange={onPageChange}
        onShowAllChange={onShowAllChange}
      />,
    )

    expect(screen.getByText('Showing 1–10 of 24')).toBeDefined()
    expect(screen.getByText('1 / 3')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(onShowAllChange).toHaveBeenCalledWith(true)

    rerender(
      <PageNavigator
        page={1}
        pageSize={10}
        showAll
        total={24}
        onPageChange={onPageChange}
        onShowAllChange={onShowAllChange}
      />,
    )
    expect(screen.getByText('Showing 1–24 of 24')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Use pages' })).toBeDefined()
  })
})
