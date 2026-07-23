// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import '../../rtl-settle'

import { SearchInput } from '@makinbakin/sdk/patterns'

afterEach(cleanup)

function SearchHarness({ initial = '' }: { initial?: string }) {
  const [query, setQuery] = useState(initial)
  return <SearchInput label="Search tasks" value={query} onValueChange={setQuery} placeholder="Search tasks…" />
}

describe('canonical search input', () => {
  it('expands inside a reserved slot on focus and collapses without losing the query', () => {
    const { container } = render(<SearchHarness />)
    const input = screen.getByRole('searchbox', { name: 'Search tasks' })
    const reserve = container.querySelector('[data-slot="search-input-reserve"]')
    const control = container.querySelector('[data-slot="search-input-control"]') as HTMLElement

    expect(reserve?.className).toContain('max-w-[22rem]')
    expect(reserve?.className).toContain('min-w-[min(100%,14rem)]')
    expect(reserve?.className).toContain('justify-end')
    expect(control.dataset.state).toBe('empty')
    expect(control.style.inlineSize).toBe('min(100%, 14rem)')

    fireEvent.focus(input)
    expect(control.dataset.state).toBe('focused')
    expect(control.style.inlineSize).toBe('100%')

    fireEvent.change(input, { target: { value: 'blocked launch approval tasks' } })
    fireEvent.blur(input)
    expect(input.getAttribute('value')).toBe('blocked launch approval tasks')
    expect(control.dataset.state).toBe('filled')
    expect(control.style.inlineSize).toContain('ch')
    expect(control.className).toContain('motion-reduce:transition-none')
    expect(input.className).toContain('text-ellipsis')
  })

  it('forwards native search semantics while keeping its durable label authoritative', () => {
    render(
      <SearchInput
        aria-describedby="search-help"
        aria-invalid="true"
        label="Search workflows"
        value=""
        onValueChange={() => {}}
      />,
    )

    const input = screen.getByRole('searchbox', { name: 'Search workflows' })
    expect(input.getAttribute('aria-describedby')).toBe('search-help')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('replaces the browser-native cancel affordance with an accessible clear action', () => {
    render(<SearchHarness initial="blocked launch approval tasks with a deliberately long owner name" />)

    const input = screen.getByRole('searchbox', { name: 'Search tasks' })
    const clear = screen.getByRole('button', { name: 'Clear Search tasks' })
    expect(input.className).toContain('[&::-webkit-search-cancel-button]:appearance-none')
    expect(clear.className).toContain('active:not-aria-[haspopup]:-translate-y-1/2')
    expect(clear.className).not.toContain('active:not-aria-[haspopup]:translate-y-px')

    fireEvent.click(clear)

    expect(input.getAttribute('value')).toBe('')
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('button', { name: 'Clear Search tasks' })).toBeNull()
  })

  it('keeps in-progress feedback inside the search control without displacing results', () => {
    const { container } = render(
      <SearchInput
        busy
        label="Search tasks"
        value="launch"
        onValueChange={() => {}}
      />,
    )

    const input = screen.getByRole('searchbox', { name: 'Search tasks' })
    expect(input.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('[data-slot="search-input-progress"]')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Searching Search tasks')
  })
})
