// @vitest-environment jsdom

import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { Pagination } from '@makinbakin/sdk/patterns'

describe('Pagination', () => {
  it('moves between bounded pages and exposes an explicit show-all mode', () => {
    const onPageChange = mock(() => {})
    const onShowAllChange = mock(() => {})

    const { rerender } = render(
      <Pagination
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
      <Pagination
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

  it('supports server-paged lists without offering an unavailable show-all mode', () => {
    const onPageChange = mock(() => {})

    render(
      <Pagination
        page={2}
        pageSize={10}
        total={24}
        onPageChange={onPageChange}
      />,
    )

    expect(screen.getByText('Showing 11–20 of 24')).toBeDefined()
    expect(screen.getByText('2 / 3')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use pages' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(onPageChange).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })
})
