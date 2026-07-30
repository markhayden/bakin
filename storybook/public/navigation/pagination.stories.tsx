import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Pagination } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Navigation/Pagination',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Pagination is the compact pagination row for long repeated-content regions: an exact "Showing X–Y of Z" range, Previous/Next with honest disabled boundaries, and an optional Show all / Use pages toggle (provide `onShowAllChange` only when the consumer can truthfully render every item — omit it for server-paged collections). It renders nothing when the collection fits on one page. The control is fully controlled: the consumer owns `page` (and `showAll`) and, on a routed page, keeps them shareable through the URL-state hooks in `@makinbakin/sdk/navigation`.',
      },
    },
    bakinCoverage: ['desktop', 'interaction', 'disabled', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <div style={{ inlineSize: 'min(90vw, 36rem)' }}>
      <Pagination
        page={2}
        pageSize={20}
        total={94}
        onPageChange={() => {}}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    const nav = canvas.getByRole('navigation', { name: 'Pagination' })
    await expect(nav).toBeVisible()
    await expect(nav).toHaveTextContent('Showing 21–40 of 94')
    await expect(canvas.getByLabelText('Page 2 of 5')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Previous' })).toBeEnabled()
    await expect(canvas.getByRole('button', { name: 'Next' })).toBeEnabled()
  },
} satisfies Story

const runs = { total: 94, pageSize: 20 }

function PagedRunHistoryExample() {
  const [page, setPage] = useState(1)
  const [showAll, setShowAll] = useState(false)
  const first = showAll ? 1 : ((page - 1) * runs.pageSize) + 1
  const last = showAll ? runs.total : Math.min(page * runs.pageSize, runs.total)

  return (
    <StoryStage
      eyebrow="Results / long collections"
      title="Page long histories without losing count"
      description="The consumer owns the page value and the visible slice, so pagination stays shareable and browser-history aware. The exact range keeps the collection size honest on every page."
    >
      <StorySection
        title="Run history"
        description="94 recorded runs. The page value belongs in the URL when a shared link should open the same slice."
      >
        <p role="status" style={{ margin: 0, maxInlineSize: '64ch', color: 'var(--bakin-color-text-muted)', lineHeight: 1.6 }}>
          Rendering runs {first}–{last}.
        </p>
        <Pagination
          ariaLabel="Run history pages"
          page={page}
          pageSize={runs.pageSize}
          total={runs.total}
          showAll={showAll}
          onPageChange={setPage}
          onShowAllChange={(next) => {
            setShowAll(next)
            setPage(1)
          }}
        />
      </StorySection>
    </StoryStage>
  )
}

export const PagedBoundaries = {
  render: () => <PagedRunHistoryExample />,
  play: async ({ canvas, userEvent }) => {
    const nav = canvas.getByRole('navigation', { name: 'Run history pages' })
    await expect(nav).toHaveTextContent('Showing 1–20 of 94')
    await expect(canvas.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }))
    await expect(nav).toHaveTextContent('Showing 21–40 of 94')
    await expect(canvas.getByLabelText('Page 2 of 5')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Previous' })).toBeEnabled()
    await expect(canvas.getByRole('status')).toHaveTextContent('Rendering runs 21–40.')
  },
} satisfies Story

export const ShowAllToggle = {
  render: () => <PagedRunHistoryExample />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Show all' }))
    const nav = canvas.getByRole('navigation', { name: 'Run history pages' })
    await expect(nav).toHaveTextContent('Showing 1–94 of 94')
    await expect(canvas.queryByRole('button', { name: 'Previous' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Next' })).toBeNull()
    await expect(canvas.getByRole('status')).toHaveTextContent('Rendering runs 1–94.')
    await userEvent.click(canvas.getByRole('button', { name: 'Use pages' }))
    await expect(nav).toHaveTextContent('Showing 1–20 of 94')
  },
} satisfies Story
