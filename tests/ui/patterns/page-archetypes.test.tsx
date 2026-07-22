// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  DetailPage,
  DetailPageAside,
  DetailPageBody,
  DetailPageMain,
  ListPage,
  ListPageContent,
  ListPageControls,
  PageHeader,
  SearchInput,
} from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('shared page header recipe', () => {
  it('keeps navigation, identity, metadata, and actions in one predictable hierarchy', () => {
    const { container } = render(
      <PageHeader
        navigation={<a href="/workflows">Back to workflows</a>}
        eyebrow="Workflows / detail"
        title="Launch approval"
        description="Coordinates the final publishing decision."
        meta={<span>workflow:launch-approval</span>}
        actions={<><Button variant="outline">Duplicate</Button><Button>Edit workflow</Button></>}
      />,
    )

    const header = container.querySelector('[data-slot="page-header"]')
    expect(header?.tagName).toBe('HEADER')
    expect(header?.className).toContain('@container/page-header')
    expect(screen.getByRole('heading', { level: 1, name: 'Launch approval' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Page actions' }).children).toHaveLength(2)
    expect(Array.from(header?.querySelectorAll('h1, button') ?? []).map((element) => element.textContent)).toEqual([
      'Launch approval',
      'Duplicate',
      'Edit workflow',
    ])
    expect(screen.getByText('Coordinates the final publishing decision.').id).toBeTruthy()
    expect(header?.getAttribute('aria-describedby')).toBe(screen.getByText('Coordinates the final publishing decision.').id)
    expect(container.querySelector('[data-slot="page-header-navigation"] a')?.textContent).toBe('Back to workflows')
    expect(container.querySelector('[data-slot="page-header-meta"]')?.textContent).toBe('workflow:launch-approval')
  })

  it('supports deliberate action labels without exposing heading-level choices', () => {
    render(<PageHeader title="Task queue" actionsLabel="Task queue actions" actions={<Button>New task</Button>} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Task queue' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Task queue actions' })).toBeTruthy()
  })

  it('keeps search, view controls, and the primary action in one stable desktop toolbar', () => {
    const { container } = render(
      <PageHeader
        title="Tasks"
        controlsLabel="Task view controls"
        controls={(
          <>
            <SearchInput label="Search tasks" value="" onValueChange={() => {}} />
            <Button variant="outline">Board</Button>
          </>
        )}
        actions={<Button>New task</Button>}
      />,
    )

    const layout = container.querySelector('[data-slot="page-header-layout"]')
    const trailing = container.querySelector('[data-slot="page-header-trailing"]')
    const controls = screen.getByRole('group', { name: 'Task view controls' })

    expect(layout?.className).toContain('@3xl/page-header:grid-cols')
    expect(trailing?.className).toContain('@3xl/page-header:flex-nowrap')
    expect(controls.className).toContain('@3xl/page-header:[&>[data-slot=search-input-reserve]]:w-[22rem]')
    expect(controls.querySelector('[data-slot="search-input-reserve"]')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Page actions' })).toBeTruthy()
  })
})

describe('list/index page recipe', () => {
  it('owns the wide page canvas and names controls and results independently', () => {
    const { container } = render(
      <ListPage id="task-index">
        <PageHeader title="Active tasks" />
        <ListPageControls label="Task filters" actions={<Button>Clear filters</Button>}>
          <label htmlFor="task-search">Search</label>
          <input id="task-search" />
        </ListPageControls>
        <ListPageContent label="Active task results" busy feedback={<p>Refreshing snapshot</p>}>
          <ul><li>Launch approval</li></ul>
        </ListPageContent>
      </ListPage>,
    )

    const page = container.querySelector('[data-archetype="list"]')
    expect(page?.id).toBe('task-index')
    expect(page?.getAttribute('data-width')).toBe('wide')
    expect(screen.getByRole('region', { name: 'Task filters' })).toBeTruthy()
    const results = screen.getByRole('region', { name: 'Active task results' })
    expect(results.getAttribute('aria-busy')).toBe('true')
    expect(results.querySelector('[data-slot="list-page-feedback"]')?.textContent).toBe('Refreshing snapshot')
    expect(results.textContent).toContain('Launch approval')
  })

  it('replaces only the result region when a terminal state is supplied', () => {
    render(
      <ListPage>
        <PageHeader title="Active tasks" />
        <ListPageContent
          label="Active task results"
          state={<SystemState kind="no-results" action={<Button>Clear filters</Button>} />}
        >
          <p>Stale result that must not render</p>
        </ListPageContent>
      </ListPage>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Active tasks' })).toBeTruthy()
    expect(screen.getByRole('status', { name: 'No results' })).toBeTruthy()
    expect(screen.queryByText('Stale result that must not render')).toBeNull()
  })
})

describe('detail page recipe', () => {
  it('provides one responsive main/aside composition without another main landmark', () => {
    const { container } = render(
      <DetailPage>
        <PageHeader title="Launch approval" />
        <DetailPageBody layout="aside" feedback={<p>Draft changes</p>}>
          <DetailPageMain><section aria-label="Workflow definition">Definition</section></DetailPageMain>
          <DetailPageAside label="Workflow context">Owner and schedule</DetailPageAside>
        </DetailPageBody>
      </DetailPage>,
    )

    const page = container.querySelector('[data-archetype="detail"]')
    expect(page?.getAttribute('data-width')).toBe('wide')
    expect(container.querySelectorAll('main')).toHaveLength(0)
    expect(container.querySelector('[data-slot="detail-page-grid"]')?.getAttribute('data-layout')).toBe('main-aside')
    expect(screen.getByRole('complementary', { name: 'Workflow context' })).toBeTruthy()
    expect(container.querySelector('[data-slot="detail-page-feedback"]')?.textContent).toBe('Draft changes')
  })

  it('replaces the body while preserving page identity and navigation', () => {
    render(
      <DetailPage width="content">
        <PageHeader navigation={<a href="/workflows">Back</a>} title="Launch approval" />
        <DetailPageBody state={<SystemState kind="permission-denied" />}>
          <DetailPageMain>Restricted definition</DetailPageMain>
        </DetailPageBody>
      </DetailPage>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Launch approval' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy()
    expect(screen.getByText('Access restricted')).toBeTruthy()
    expect(screen.queryByText('Restricted definition')).toBeNull()
  })
})
