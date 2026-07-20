// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import '../../rtl-settle'

import { Inline, PageShell, Stack } from '@makinbakin/sdk/layout'

afterEach(() => cleanup())

describe('public layout primitives', () => {
  it('provides a contained, responsive page canvas with finite width and padding modes', () => {
    const { container } = render(
      <PageShell id="tasks-page" width="content" padding="compact">
        <h1>Tasks</h1>
      </PageShell>,
    )

    const shell = container.querySelector('[data-slot="page-shell"]')
    const content = container.querySelector('[data-slot="page-shell-content"]')
    expect(shell?.id).toBe('tasks-page')
    expect(shell?.getAttribute('data-width')).toBe('content')
    expect(shell?.getAttribute('data-padding')).toBe('compact')
    expect(shell?.className).toContain('@container/page-shell')
    expect(content?.className).toContain('max-w-3xl')
    expect(content?.className).toContain('@md/page-shell:p-bakin-4')
  })

  it('maps Stack rhythm and alignment onto a semantic wrapper', () => {
    const { container } = render(
      <Stack as="section" gap="section" align="start" aria-label="Task summary">
        <div>Active</div>
        <div>Blocked</div>
      </Stack>,
    )

    const stack = container.querySelector('section')
    expect(stack?.getAttribute('data-slot')).toBe('stack')
    expect(stack?.getAttribute('data-gap')).toBe('section')
    expect(stack?.className).toContain('gap-bakin-6')
    expect(stack?.className).toContain('items-start')
  })

  it('wraps Inline content by default and supports an intentional no-wrap row', () => {
    const { container, rerender } = render(
      <Inline as="nav" gap="item" align="center" justify="between" aria-label="Task actions">
        <button>Export</button>
        <button>New task</button>
      </Inline>,
    )

    let inline = container.querySelector('nav')
    expect(inline?.getAttribute('data-wrap')).toBe('true')
    expect(inline?.className).toContain('flex-wrap')
    expect(inline?.className).toContain('justify-between')

    rerender(<Inline wrap={false}><span>One line</span></Inline>)
    inline = container.querySelector('[data-slot="inline"]')
    expect(inline?.getAttribute('data-wrap')).toBe('false')
    expect(inline?.className).toContain('flex-nowrap')
  })
})
