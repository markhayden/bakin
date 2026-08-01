// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { PageHeader, SearchInput } from '@makinbakin/sdk/patterns'
import { Button, DropdownMenuItem } from '@makinbakin/sdk/ui'

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
    expect(screen.getByRole('heading', { level: 1, name: 'Launch approval' }).className).toContain('max-w-[30ch]')
    expect(screen.getByRole('group', { name: 'Page actions' }).children).toHaveLength(2)
    expect(Array.from(header?.querySelectorAll('h1, button') ?? []).map((element) => element.textContent)).toEqual([
      'Launch approval',
      'Duplicate',
      'Edit workflow',
    ])
    expect(screen.getByText('Coordinates the final publishing decision.').id).toBeTruthy()
    expect(header?.getAttribute('aria-describedby')).toBe(screen.getByText('Coordinates the final publishing decision.').id)
    expect(container.querySelector('[data-slot="page-header-copy"]')?.className).toContain('@3xl/page-header:max-w-[50cqw]')
    expect(container.querySelector('[data-slot="page-header-description"]')?.className).toContain('max-w-none')
    expect(container.querySelector('[data-slot="page-header-navigation"] a')?.textContent).toBe('Back to workflows')
    expect(container.querySelector('[data-slot="page-header-navigation"]')?.parentElement).toBe(
      container.querySelector('[data-slot="page-header-eyebrow"]')?.parentElement,
    )
    expect(container.querySelector('[data-slot="page-header-context"]')?.className).toContain('items-center')
    expect(container.querySelector('[data-slot="page-header-meta"]')?.textContent).toBe('workflow:launch-approval')
  })

  it('supports deliberate action labels without exposing heading-level choices', () => {
    render(<PageHeader title="Task queue" actionsLabel="Task queue actions" actions={<Button>New task</Button>} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Task queue' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Task queue actions' })).toBeTruthy()
  })

  it('reserves a circular context-row menu for secondary detail actions', async () => {
    const { container } = render(
      <PageHeader
        navigation={<a href="/workflows">Back to workflows</a>}
        eyebrow="Workflows / detail"
        title="Launch approval"
        overflowActionsLabel="Workflow actions"
        overflowActions={(
          <>
            <DropdownMenuItem>Duplicate workflow</DropdownMenuItem>
            <DropdownMenuItem variant="danger">Delete</DropdownMenuItem>
          </>
        )}
        actions={<Button>Edit workflow</Button>}
      />,
    )

    const context = container.querySelector('[data-slot="page-header-context"]')
    const trigger = screen.getByRole('button', { name: 'Workflow actions' })

    expect(context?.className).toContain('@3xl/page-header:col-span-2')
    expect(trigger.getAttribute('data-size')).toBe('icon-sm')
    expect(trigger.className).toContain('rounded-bakin-pill')
    expect(container.querySelector('[data-slot="page-header-trailing"]')?.className).toContain(
      '@3xl/page-header:row-start-2',
    )

    fireEvent.click(trigger)
    expect(await screen.findByRole('menuitem', { name: 'Duplicate workflow' })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })

  it('allows media and editor headers to follow the available primary-column measure', () => {
    const { container } = render(
      <PageHeader
        measure="wide"
        title="Gourmet seasoned popcorn with rosemary and parmesan"
        description="Media context and immutable version history."
        actions={<Button>Edit asset</Button>}
      />,
    )

    const header = container.querySelector('[data-slot="page-header"]')
    expect(header?.getAttribute('data-measure')).toBe('wide')
    expect(container.querySelector('[data-slot="page-header-copy"]')?.className).toContain('max-w-none')
    expect(container.querySelector('[data-slot="page-header-title"]')?.className).toContain('max-w-none')
    expect(container.querySelector('[data-slot="page-header-description"]')?.className).toContain('max-w-none')
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
