// @vitest-environment jsdom
import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { actRender } from '../../rtl-settle'

import {
  PageHeader,
  WorkspacePage,
  WorkspacePageBody,
  WorkspacePageCompactHeader,
  WorkspacePageHeader,
} from '@makinbakin/sdk/patterns'
import { DropdownMenuItem } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('workspace page recipe', () => {
  it('releases viewport subscriptions and measured properties on unmount', async () => {
    const previous = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const viewport = Object.assign(new EventTarget(), { width: 320, height: 400, offsetTop: 0, offsetLeft: 0 })
    const add = spyOn(viewport, 'addEventListener')
    const remove = spyOn(viewport, 'removeEventListener')
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    try {
      const mounted = await actRender(() => render(<WorkspacePage viewport="visual"><WorkspacePageBody>Editor</WorkspacePageBody></WorkspacePage>))
      const owner = mounted.container.querySelector<HTMLElement>('[data-slot="workspace-viewport"]')!
      expect(add.mock.calls.map(call => call[0])).toEqual(['resize', 'scroll'])
      await act(async () => { viewport.dispatchEvent(new Event('resize')); mounted.unmount() })
      expect(remove.mock.calls).toEqual(add.mock.calls)
      expect(owner.style.getPropertyValue('--bakin-workspace-viewport-height')).toBe('')
    } finally {
      if (previous) Object.defineProperty(window, 'visualViewport', previous)
      else Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  it('reserves an input accessory after the flexible canvas', async () => {
    const { container } = await actRender(() => render(
      <WorkspacePage viewport="visual">
        <WorkspacePageBody inputAccessory={<button>Complete</button>}>
          <textarea aria-label="Editor" />
        </WorkspacePageBody>
      </WorkspacePage>,
    ))
    const canvas = container.querySelector('[data-slot="workspace-page-canvas"]')
    const accessory = container.querySelector('[data-slot="workspace-page-input-accessory"]')
    expect(canvas?.contains(screen.getByRole('textbox'))).toBe(true)
    expect(accessory?.contains(screen.getByRole('button', { name: 'Complete' }))).toBe(true)
    expect(canvas!.compareDocumentPosition(accessory!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('[data-slot="workspace-viewport"]')).toBeTruthy()
  })

  it('preserves host geometry and the direct body children by default', async () => {
    const { container } = await actRender(() => render(
      <WorkspacePage><WorkspacePageBody><textarea aria-label="Editor" /></WorkspacePageBody></WorkspacePage>,
    ))
    expect(container.querySelector('[data-slot="workspace-viewport"]')).toBeNull()
    expect(screen.getByRole('textbox').parentElement?.dataset.slot).toBe('workspace-page-body')
  })

  it('opens secondary actions through the compact header public props', async () => {
    render(
      <WorkspacePage mode="immersive">
        <WorkspacePageCompactHeader
          title="Workflow"
          overflowActionsLabel="Workflow actions"
          overflowActions={<DropdownMenuItem>Duplicate workflow</DropdownMenuItem>}
        />
      </WorkspacePage>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Workflow actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Duplicate workflow' })).toBeTruthy()
  })

  it('keeps canonical header insets while the body owns the flush remaining canvas', () => {
    const { container } = render(
      <WorkspacePage>
        <WorkspacePageHeader>
          <PageHeader title="Conversation workspace" />
        </WorkspacePageHeader>
        <WorkspacePageBody>
          <aside>Threads</aside>
          <section>Conversation</section>
        </WorkspacePageBody>
      </WorkspacePage>,
    )

    const page = container.querySelector('[data-archetype="workspace"]')
    expect(page?.getAttribute('data-width')).toBe('full')
    expect(page?.getAttribute('data-padding')).toBe('none')
    expect(page?.getAttribute('data-gap')).toBe('none')
    expect(page?.className).toContain('overflow-hidden')

    const header = container.querySelector('[data-slot="workspace-page-header"]')
    expect(header?.className).toContain('px-bakin-4')
    expect(header?.className).toContain('pb-bakin-4')
    expect(header?.className).not.toContain('pb-bakin-8')
    expect(header?.className).toContain('@xl/page-shell:px-bakin-8')

    const body = container.querySelector('[data-slot="workspace-page-body"]')
    expect(body?.className).toContain('flex-1')
    expect(body?.className).toContain('overflow-hidden')
    expect(body?.className).toContain('pb-[env(safe-area-inset-bottom)]')
    expect(body?.className).not.toContain('var(--bakin-layout-size-control)')
    expect(body?.className).toContain('@md/page-shell:pb-0')
    expect(container.querySelector('main')).toBeNull()
  })

  it('provides a sticky compact mobile context row for immersive workspaces', () => {
    const { container, getByText } = render(
      <WorkspacePage mode="immersive">
        <WorkspacePageHeader>
          <PageHeader
            navigation={<button type="button">Back to workflows</button>}
            eyebrow="Workflows / detail"
            title="Image generation"
            description="A deliberately long description that belongs to the scrollable page identity."
            actions={<button type="button">Full header edit</button>}
          />
        </WorkspacePageHeader>
        <WorkspacePageCompactHeader
          navigation={<button type="button">Back</button>}
          title="Image generation"
          action={<button type="button">Edit</button>}
          overflowActions={<button type="button">Delete</button>}
        />
        <WorkspacePageBody>
          <section>Workflow canvas</section>
        </WorkspacePageBody>
      </WorkspacePage>,
    )

    const page = container.querySelector('[data-archetype="workspace"]')
    expect(page?.getAttribute('data-mode')).toBe('immersive')
    // Immersive scroll-away applies on EVERY viewport — no desktop opt-out.
    expect(page?.className).toContain('overflow-y-auto')
    expect(page?.className).not.toContain('@md/page-shell:overflow-hidden')

    const compactHeader = container.querySelector(
      '[data-slot="workspace-page-compact-header"]',
    )
    // The sticky lives on the anchor (the row's flow slot); in non-flow
    // desktop the row renders as a zero-height-anchored overlay ABOVE it —
    // no reserved dead band between header and body.
    const anchor = container.querySelector(
      '[data-slot="workspace-page-compact-anchor"]',
    )
    expect(anchor?.className).toContain('sticky')
    expect(anchor?.className).toContain('top-0')
    expect(anchor?.className).toContain('@md/page-shell:relative')
    expect(compactHeader?.className).toContain('@md/page-shell:absolute')
    expect(compactHeader?.className).toContain('@md/page-shell:bottom-full')
    // Desktop hides the row entirely pre-stick — it appears as the overlay
    // once the header tail is spent; mobile keeps it always visible.
    expect(compactHeader?.className).toContain('@md/page-shell:hidden')
    expect(compactHeader?.className).not.toContain('@md/page-shell:invisible')
    expect(
      getByText('Image generation', {
        selector: '[data-slot="workspace-page-compact-title"]',
      }),
    ).toBeTruthy()

    const fullHeader = container.querySelector(
      '[data-slot="workspace-page-header"]',
    )
    expect(fullHeader?.className).toContain(
      '[&_[data-slot=page-header-context]]:hidden',
    )
    expect(fullHeader?.className).toContain(
      '@md/page-shell:[&_[data-slot=page-header-context]]:flex',
    )
    expect(fullHeader?.className).toContain(
      '[&_[data-slot=page-header-trailing]]:hidden',
    )
    expect(fullHeader?.className).toContain(
      '@md/page-shell:[&_[data-slot=page-header-trailing]]:flex',
    )
    expect(fullHeader).not.toBeNull()
    expect(compactHeader).not.toBeNull()
    expect(
      fullHeader!.compareDocumentPosition(compactHeader!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    const body = container.querySelector('[data-slot="workspace-page-body"]')
    expect(body?.className).toContain(
      'h-[calc(100%-var(--bakin-workspace-compact-header-height))]',
    )
    // The compact-height body applies on every viewport now — the identity
    // scrolls away on desktop too.
    expect(body?.className).not.toContain('@md/page-shell:h-auto')
  })
})
