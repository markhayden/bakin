// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import '../../rtl-settle'

import {
  PageHeader,
  WorkspacePage,
  WorkspacePageBody,
  WorkspacePageCompactHeader,
  WorkspacePageHeader,
} from '@makinbakin/sdk/patterns'

afterEach(() => cleanup())

describe('workspace page recipe', () => {
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
    expect(compactHeader?.className).toContain('sticky')
    expect(compactHeader?.className).toContain('top-0')
    // Desktop shows the row only once stuck; pre-stick it stays invisible
    // (flow box preserved so the shell can scroll far enough to stick it).
    expect(compactHeader?.className).toContain('@md/page-shell:invisible')
    expect(compactHeader?.className).not.toContain('@md/page-shell:hidden')
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
