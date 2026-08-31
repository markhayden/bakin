import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { SearchInput } from '@makinbakin/sdk/patterns'

import { DEFAULT_STORY_FIXTURE } from '../../fixtures'
import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Navigation/SearchInput',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'SearchInput is the compact query field for list and result pages. It starts collapsed, expands inside reserved layout space while focused (so peer controls never reflow), then shrinks back to fit the current query up to its cap; longer values stay intact behind an ellipsis and the canonical clear action, and `busy` announces an in-flight search without moving the layout. The field is controlled: the consumer owns `value` and, on a routed page, keeps the query shareable through the URL-state hooks in `@makinbakin/sdk/navigation` — the pattern only owns presentation.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'focus-expansion', 'query-truncation', 'clearing', 'busy', 'reduced-motion', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const motionStoryFixture = { ...DEFAULT_STORY_FIXTURE, reducedMotion: false }
const longSearchQuery = 'blocked launch approval tasks with a deliberately long owner name'

interface SearchInputCanonicalArgs {
  /** Which edge the compact field grows from inside its reserved space. */
  align: 'start' | 'end'
  /** Span the full row width on narrow containers. */
  mobileFullWidth: boolean
  /** Announce an in-flight search without moving the layout. */
  busy: boolean
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    align: 'end',
    mobileFullWidth: false,
    busy: false,
  },
  // The controlled value/onValueChange pair stays fixed, so the presentation
  // knobs declare themselves.
  argTypes: {
    align: { control: 'select', options: ['start', 'end'] },
    mobileFullWidth: { control: 'boolean' },
    busy: { control: 'boolean' },
  },
  render: (args: SearchInputCanonicalArgs) => (
    <SearchInput
      label="Search tasks"
      value=""
      onValueChange={() => {}}
      placeholder="Search tasks…"
      align={args.align}
      mobileFullWidth={args.mobileFullWidth}
      busy={args.busy}
    />
  ),
  play: async ({ canvas, args }) => {
    const search = canvas.getByRole('searchbox', { name: 'Search tasks' })
    await expect(search).toBeVisible()
    await expect(search.closest('[data-slot="search-input-control"]')).toHaveAttribute('data-state', 'empty')
    if (args.busy) await expect(search).toHaveAttribute('aria-busy', 'true')
  },
} satisfies StoryObj<SearchInputCanonicalArgs>

function SearchInputExample({ initialQuery = '', busy = false }: { initialQuery?: string; busy?: boolean }) {
  const [query, setQuery] = useState(initialQuery)

  return (
    <StoryStage
      eyebrow="Query / compact discovery"
      title="Expand search without moving the page"
      description="The field starts compact, expands inside reserved space while focused, then shrinks to fit the current query up to its cap. Longer values remain intact behind an ellipsis and the canonical clear action."
    >
      <StorySection
        title="Task search"
        description="A routed page stores the controlled query in the existing URL-state contract; this pattern only owns presentation."
      >
        <SearchInput
          label="Search tasks"
          value={query}
          onValueChange={setQuery}
          placeholder="Search tasks…"
          busy={busy}
        />
        <p role="status" style={{ margin: 0, maxInlineSize: '64ch', color: 'var(--bakin-color-text-muted)', lineHeight: 1.6 }}>
          {query ? `Current query: ${query}` : 'No query entered'}
        </p>
      </StorySection>
    </StoryStage>
  )
}

export const SearchBehavior = {
  render: () => <SearchInputExample />,
  parameters: {
    bakinFixture: motionStoryFixture,
  },
  play: async ({ canvas }) => {
    const search = canvas.getByRole('searchbox', { name: 'Search tasks' })
    const control = search.closest('[data-slot="search-input-control"]') as HTMLElement

    await expect(control).toHaveAttribute('data-state', 'empty')
    await expect(search).toHaveValue('')
  },
} satisfies Story

export const LongQuery = {
  render: () => <SearchInputExample initialQuery={longSearchQuery} />,
  play: async ({ canvas }) => {
    const search = canvas.getByRole('searchbox', { name: 'Search tasks' })
    const control = search.closest('[data-slot="search-input-control"]') as HTMLElement

    await expect(control).toHaveAttribute('data-state', 'filled')
    await expect(search).toHaveValue(longSearchQuery)
    await expect(canvas.getByRole('button', { name: 'Clear Search tasks' })).toBeVisible()
  },
} satisfies Story

export const SearchInProgress = {
  render: () => <SearchInputExample initialQuery="blocked tasks" busy />,
  play: async ({ canvas }) => {
    const search = canvas.getByRole('searchbox', { name: 'Search tasks' })
    await expect(search).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.getByText('Searching Search tasks').closest('[role="status"]')).toBeTruthy()
    await expect(search.closest('[data-slot="search-input-control"]')?.querySelector('[data-slot="search-input-progress"]')).toBeTruthy()
  },
} satisfies Story
