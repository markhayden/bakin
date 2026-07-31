// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import '../../rtl-settle'

import { BoundedOverflow, Grid, Inline, PageShell, Section, Stack } from '@makinbakin/sdk/layout'

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
    expect(shell?.className).toContain('flex-col')
    expect(content?.className).toContain('max-w-3xl')
    expect(content?.className).toContain('@md/page-shell:px-bakin-4')
    expect(content?.className).toContain('pb-[calc((var(--bakin-layout-space-8)*2)+env(safe-area-inset-bottom))]')
    expect(content?.className).toContain('shrink-0')
    expect(content?.className).not.toMatch(/\bflex-1\b/)
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

  it('maps responsive Grid recipes without accepting arbitrary column values', () => {
    const { container, rerender } = render(
      <Grid as="ul" layout="quarters" gap="section" align="start" aria-label="Runtime signals">
        <li>Healthy</li>
        <li>Delayed</li>
      </Grid>,
    )

    let grid = container.querySelector('ul')
    expect(grid?.getAttribute('data-slot')).toBe('grid')
    expect(grid?.getAttribute('data-layout')).toBe('quarters')
    expect(container.querySelector('[data-slot="grid-container"]')?.className).toContain('@container/layout-grid')
    expect(grid?.className).toContain('@4xl/layout-grid:grid-cols-4')
    expect(grid?.className).toContain('items-start')

    rerender(<Grid layout="main-aside"><div>Main</div><aside>Aside</aside></Grid>)
    grid = container.querySelector('[data-slot="grid"]')
    expect(grid?.className).toContain('@3xl/layout-grid:grid-cols-[minmax(0,1.6fr)_minmax(16rem,.8fr)]')
  })

  it('fills the container with fixed-minimum tracks in the auto-fill recipe', () => {
    const { container } = render(
      <Grid as="ul" layout="auto-fill" aria-label="Asset cards">
        <li>Launch hero</li>
        <li>Brand palette sheet</li>
      </Grid>,
    )

    const grid = container.querySelector('[data-slot="grid"]')
    expect(grid?.getAttribute('data-layout')).toBe('auto-fill')
    // auto-fill (not auto-fit) keeps empty tracks so sparse grids hold the
    // fixed 250px card width instead of stretching a few items.
    expect(grid?.className).toContain(
      '[grid-template-columns:repeat(auto-fill,minmax(min(100%,15.625rem),1fr))]',
    )
    expect(grid?.className).not.toContain('auto-fit')
  })

  it('keeps a split grid single-column until each item has comfortable width', () => {
    const { container } = render(
      <Grid layout="split">
        <article>First bounded object</article>
        <article>Second bounded object</article>
      </Grid>,
    )

    const grid = container.querySelector('[data-slot="grid"]')
    expect(grid?.className).toContain('grid-cols-1')
    expect(grid?.className).toContain('@lg/layout-grid:grid-cols-2')
    expect(grid?.className).not.toContain('@sm/layout-grid:grid-cols-2')
  })

  it('gives Section consistent rhythm and an optional semantic divider', () => {
    const { container } = render(
      <Section spacing="compact" divider="top" aria-labelledby="activity-title">
        <h2 id="activity-title">Activity</h2>
        <p>Latest runtime events</p>
      </Section>,
    )

    const section = container.querySelector('section')
    expect(section?.getAttribute('data-slot')).toBe('section')
    expect(section?.getAttribute('data-spacing')).toBe('compact')
    expect(section?.getAttribute('data-divider')).toBe('top')
    expect(section?.className).toContain('gap-bakin-4')
    expect(section?.className).toContain('border-t')
  })

  it('contains wide content in a labelled keyboard-scrollable region', () => {
    const { container } = render(
      <BoundedOverflow label="Task run history" data-testid="history-scroll">
        <table><tbody><tr><td>Task</td></tr></tbody></table>
      </BoundedOverflow>,
    )

    const overflow = container.querySelector('[data-slot="bounded-overflow"]')
    expect(overflow?.getAttribute('role')).toBe('region')
    expect(overflow?.getAttribute('aria-label')).toBe('Task run history')
    expect(overflow?.getAttribute('tabindex')).toBe('0')
    expect(overflow?.getAttribute('data-testid')).toBe('history-scroll')
    expect(overflow?.className).toContain('overflow-x-auto')
    expect(overflow?.className).toContain('overscroll-x-contain')
  })
})
