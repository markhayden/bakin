// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  Page,
  PageAside,
  PageBody,
  PageCanvas,
  PageComposer,
  PageControls,
  PageHeader,
  PageTimeline,
} from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('consolidated page archetype', () => {
  it('owns the full canvas with document scroll and default density by default', () => {
    const { container } = render(
      <Page id="task-index">
        <PageHeader title="Active tasks" />
        <PageBody label="Active task results">
          <ul><li>Launch approval</li></ul>
        </PageBody>
      </Page>,
    )

    const page = container.querySelector('[data-archetype="page"]')
    expect(page?.id).toBe('task-index')
    expect(page?.getAttribute('data-width')).toBe('full')
    expect(page?.getAttribute('data-scroll')).toBe('page')
    expect(page?.getAttribute('data-density')).toBe('default')
    expect(page?.getAttribute('data-padding')).toBe('default')
    expect(page?.getAttribute('data-gap')).toBe('page')
    expect(page?.className).not.toContain('overflow-hidden')
    const content = page?.querySelector('[data-slot="page-shell-content"]')
    expect(content?.className).toContain('max-w-none')
    expect(content?.className).toContain('gap-bakin-8')
    expect(content?.className).toContain('env(safe-area-inset-bottom)')
  })

  it('bounds standard width to the content measure', () => {
    const { container } = render(
      <Page width="standard">
        <PageBody>
          <p>Focused document</p>
        </PageBody>
      </Page>,
    )

    const page = container.querySelector('[data-archetype="page"]')
    expect(page?.getAttribute('data-width')).toBe('content')
    expect(page?.querySelector('[data-slot="page-shell-content"]')?.className).toContain('max-w-3xl')
  })

  it('bounds contained pages so named child panes own scrolling', () => {
    const { container } = render(
      <Page scroll="contained">
        <PageHeader title="Production plan" />
        <PageBody>
          <p>Scrollable plan regions</p>
        </PageBody>
      </Page>,
    )

    const page = container.querySelector('[data-archetype="page"]')
    expect(page?.getAttribute('data-scroll')).toBe('contained')
    expect(page?.className).toContain('h-full')
    expect(page?.className).toContain('min-h-0')
    expect(page?.className).toContain('overflow-hidden')
    expect(page?.className).toContain('[&>[data-slot=page-shell-content]]:h-full')
    expect(page?.className).toContain('[&>[data-slot=page-shell-content]]:min-h-0')
    expect(page?.className).toContain('[&>[data-slot=page-shell-content]]:shrink')
    expect(page?.className).toContain('[&>[data-slot=page-shell-content]]:overflow-hidden')
  })

  it('carries the workflow workspace padding contribution as compact density', () => {
    const { container } = render(
      <Page density="compact">
        <PageBody gap="content">
          <p>Canvas</p>
        </PageBody>
      </Page>,
    )

    const page = container.querySelector('[data-archetype="page"]')
    expect(page?.getAttribute('data-density')).toBe('compact')
    expect(page?.getAttribute('data-padding')).toBe('compact')
    expect(page?.getAttribute('data-gap')).toBe('content')
    expect(page?.querySelector('[data-slot="page-shell-content"]')?.className).toContain('gap-bakin-4')
  })

  it('makes the page timeline the one internal scroller only inside a contained page', () => {
    const { container, rerender } = render(
      <Page scroll="contained">
        <PageBody gap="content" label="Conversation">
          <PageTimeline label="Conversation log"><article>Message</article></PageTimeline>
          <PageComposer><textarea /></PageComposer>
        </PageBody>
      </Page>,
    )

    const log = screen.getByRole('log', { name: 'Conversation log' })
    expect(log.getAttribute('aria-live')).toBe('polite')
    expect(log.className).toContain('overflow-y-auto')
    expect(log.className).toContain('overscroll-contain')
    const composer = container.querySelector('[data-slot="page-composer"]')
    expect(composer?.contains(log)).toBe(false)

    rerender(
      <Page scroll="page">
        <PageBody gap="content" label="Conversation">
          <PageTimeline label="Conversation log"><article>Message</article></PageTimeline>
          <PageComposer><textarea /></PageComposer>
        </PageBody>
      </Page>,
    )
    expect(screen.getByRole('log', { name: 'Conversation log' }).className).not.toContain('overflow-y-auto')
  })
})

describe('page body content slot', () => {
  it('retains feedback with usable busy content on the section default gap', () => {
    render(
      <PageBody busy label="Active task results" feedback={<p>Refreshing snapshot</p>}>
        <ul><li>Launch approval</li></ul>
      </PageBody>,
    )

    const body = screen.getByRole('region', { name: 'Active task results' })
    expect(body.tagName).toBe('SECTION')
    expect(body.getAttribute('aria-busy')).toBe('true')
    expect(body.getAttribute('data-content-state')).toBe('ready')
    expect(body.getAttribute('data-gap')).toBe('section')
    expect(body.className).toContain('gap-bakin-6')
    expect(body.className).toContain('flex-1')
    expect(body.querySelector('[data-slot="page-body-feedback"]')?.textContent).toBe('Refreshing snapshot')
    expect(body.textContent).toContain('Launch approval')
  })

  it('covers the observed content and page gap values', () => {
    const { container, rerender } = render(<PageBody gap="content"><p>Dense</p></PageBody>)
    expect(container.querySelector('[data-slot="page-body"]')?.className).toContain('gap-bakin-4')

    rerender(<PageBody gap="page"><p>Roomy</p></PageBody>)
    expect(container.querySelector('[data-slot="page-body"]')?.className).toContain('gap-bakin-8')
  })

  it('stays a generic unnamed container when no accessible name is supplied', () => {
    const { container } = render(<PageBody><p>Detail flow</p></PageBody>)

    const body = container.querySelector('[data-slot="page-body"]')
    expect(body?.hasAttribute('aria-label')).toBe(false)
    expect(body?.hasAttribute('aria-labelledby')).toBe(false)
    expect(body?.hasAttribute('aria-busy')).toBe(false)
    expect(screen.queryAllByRole('region')).toHaveLength(0)
  })

  it('replaces only the body region when a terminal state is supplied', () => {
    const { container } = render(
      <Page>
        <PageHeader title="Active tasks" />
        <PageBody
          label="Active task results"
          state={<SystemState kind="no-results" action={<Button>Clear filters</Button>} />}
        >
          <p>Stale result that must not render</p>
        </PageBody>
      </Page>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Active tasks' })).toBeTruthy()
    expect(screen.getByRole('status', { name: 'No results' })).toBeTruthy()
    expect(screen.queryByText('Stale result that must not render')).toBeNull()
    const state = container.querySelector('[data-slot="page-body-state"]')
    expect(state?.className).toContain('flex-1')
    expect(state?.className).toContain('[&>[data-slot=system-state]]:flex-1')
    expect(container.querySelector('[data-slot="page-body"]')?.getAttribute('data-content-state')).toBe('replaced')
  })

  it('provides one responsive main/aside composition on the main-aside grid recipe', () => {
    const { container } = render(
      <PageBody layout="aside" feedback={<p>Draft changes</p>}>
        <section aria-label="Workflow definition">Definition</section>
        <PageAside label="Workflow context">Owner and schedule</PageAside>
      </PageBody>,
    )

    const body = container.querySelector('[data-slot="page-body"]')
    expect(body?.getAttribute('data-layout')).toBe('aside')
    const gridRegion = container.querySelector('[data-slot="page-body-grid"]')
    expect(gridRegion?.getAttribute('data-layout')).toBe('main-aside')
    expect(gridRegion?.className).toContain('flex-1')
    expect(gridRegion?.className).toContain('[&>[data-slot=grid-container]]:flex-1')
    expect(gridRegion?.className).toContain('[&>[data-slot=grid-container]>[data-slot=grid]]:flex-1')
    const grid = gridRegion?.querySelector('[data-slot="grid"]')
    expect(grid?.getAttribute('data-layout')).toBe('main-aside')
    expect(grid?.getAttribute('data-align')).toBe('start')
    expect(grid?.getAttribute('data-gap')).toBe('section')
    const aside = screen.getByRole('complementary', { name: 'Workflow context' })
    expect(aside.className).toContain('@3xl/layout-grid:border-l')
    expect(container.querySelector('[data-slot="page-body-feedback"]')?.textContent).toBe('Draft changes')
  })

  it('keeps single layout free of the aside grid wrapper', () => {
    const { container } = render(<PageBody><p>Single flow</p></PageBody>)
    expect(container.querySelector('[data-slot="page-body"]')?.getAttribute('data-layout')).toBe('single')
    expect(container.querySelector('[data-slot="page-body-grid"]')).toBeNull()
  })
})

describe('page controls', () => {
  it('names a borderless wrapping section region by default', () => {
    render(
      <PageControls label="Task filters" actions={<Button>Clear filters</Button>}>
        <label htmlFor="task-search">Search</label>
        <input id="task-search" />
      </PageControls>,
    )

    const controls = screen.getByRole('region', { name: 'Task filters' })
    expect(controls.tagName).toBe('SECTION')
    expect(controls.getAttribute('data-as')).toBe('section')
    expect(controls.getAttribute('data-divider')).toBe('false')
    expect(controls.className).not.toContain('border-t')
    expect(controls.className).toContain('@lg/page-shell:flex-row')
    expect(controls.querySelector('[data-slot="page-controls-set"]')?.textContent).toContain('Search')
    expect(controls.querySelector('[data-slot="page-controls-actions"]')?.textContent).toBe('Clear filters')
  })

  it('uses a top divider only when a section begins a genuinely separate page zone', () => {
    render(
      <PageControls label="Separated filters" divider>
        <button type="button">Filter</button>
      </PageControls>,
    )

    const controls = screen.getByRole('region', { name: 'Separated filters' })
    expect(controls.getAttribute('data-divider')).toBe('true')
    expect(controls.className).toContain('border-t')
    expect(controls.className).toContain('pt-bakin-4')
  })

  it('switches to the ARIA toolbar contract with its bottom divider by default', () => {
    render(
      <PageControls as="toolbar" label="Graph tools">
        <Button>Zoom to fit</Button>
      </PageControls>,
    )

    const toolbar = screen.getByRole('toolbar', { name: 'Graph tools' })
    expect(toolbar.tagName).toBe('DIV')
    expect(toolbar.getAttribute('data-as')).toBe('toolbar')
    expect(toolbar.getAttribute('data-divider')).toBe('true')
    expect(toolbar.className).toContain('border-b')
    expect(toolbar.className).toContain('pb-bakin-4')
    expect(toolbar.className).not.toContain('border-t')
  })

  it('lets a toolbar opt out of its divider', () => {
    render(
      <PageControls as="toolbar" label="Quiet tools" divider={false}>
        <Button>Auto-layout</Button>
      </PageControls>,
    )

    const toolbar = screen.getByRole('toolbar', { name: 'Quiet tools' })
    expect(toolbar.getAttribute('data-divider')).toBe('false')
    expect(toolbar.className).not.toContain('border-b')
  })
})

describe('named page slots', () => {
  it('renders PageAside as a named complementary rail on the page-aside slot', () => {
    const { container } = render(<PageAside label="Workflow context">Rail</PageAside>)

    const aside = container.querySelector('[data-slot="page-aside"]')
    expect(aside?.tagName).toBe('ASIDE')
    expect(aside?.className).toContain('@3xl/layout-grid:border-l')
    expect(screen.getByRole('complementary', { name: 'Workflow context' })).toBeTruthy()
  })

  it('keeps PageCanvas a named bounded region with finite orientation metadata', () => {
    render(
      <>
        <PageCanvas label="Workflow canvas" orientation="horizontal">Graph</PageCanvas>
        <PageCanvas label="Default canvas">Graph</PageCanvas>
      </>,
    )

    const horizontal = screen.getByRole('region', { name: 'Workflow canvas' })
    expect(horizontal.getAttribute('data-orientation')).toBe('horizontal')
    expect(horizontal.hasAttribute('data-page-canvas')).toBe(true)
    expect(horizontal.className).toContain('rounded-bakin-surface')
    const vertical = screen.getByRole('region', { name: 'Default canvas' })
    expect(vertical.getAttribute('data-orientation')).toBe('vertical')
  })
})
