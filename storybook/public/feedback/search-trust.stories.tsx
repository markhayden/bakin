import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import {
  ScoreOverlay,
  SearchDegradedChip,
  SearchPartialChip,
  SearchUnavailable,
} from '@makinbakin/sdk/patterns'
import { buttonVariants } from '@makinbakin/sdk/ui'

import './search-trust.stories.css'

const meta = {
  title: 'Components/Feedback/Search trust states',
  component: SearchUnavailable,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Search patterns distinguish engine failure, lower-quality fallback, partial source coverage, and relevance-debug evidence. They never present degraded search as a normal empty result.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'non-color', 'reduced-motion', 'error', 'dense-data'],
  },
} satisfies Meta<typeof SearchUnavailable>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { retry: () => {}, healthAction: null },
  argTypes: {
    scope: { control: 'select', options: ['inline', 'section', 'page'] },
    headingLevel: { control: 'select', options: [2, 3, 4] },
    // Retry re-runs the consumer's query; the health action is a host-owned link.
    retry: { control: false },
    healthAction: { control: false },
  },
  play: async ({ canvas }) => {
    const state = canvas.getByRole('alert', { name: 'Search is unavailable' })
    await expect(state).toBeVisible()
    await expect(state).toHaveAttribute('data-recovery', 'available')
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeVisible()
  },
} satisfies Story

export const AvailabilityAndEvidence = {
  render: () => (
    <main className="bakin-search-trust-story">
      <PageShell width="wide">
        <Stack gap="section">
          <header className="bakin-search-trust-story__intro">
            <p>Search / honest quality</p>
            <h1>Say what search actually returned</h1>
            <p>Engine availability and result quality are different states. Every signal uses visible language in addition to color.</p>
          </header>
          <div className="bakin-search-trust-story__grid">
            <section aria-labelledby="unavailable-heading" className="bakin-search-trust-story__surface">
              <h2 id="unavailable-heading">No trustworthy query result</h2>
              <p>Use the full state when the surface has no browse or local fallback to show.</p>
              <SearchUnavailable
                retry={() => {}}
                healthAction={(
                  <a href="/health" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    Open health
                  </a>
                )}
              />
            </section>
            <section aria-labelledby="signals-heading" className="bakin-search-trust-story__surface">
              <h2 id="signals-heading">Results remain usable with caveats</h2>
              <p>Inline signals sit beside the query controls or result summary, never hidden behind color alone.</p>
              <div className="bakin-search-trust-story__signals">
                <SearchDegradedChip />
                <SearchPartialChip
                  meta={{
                    partial: true,
                    tables: [
                      { table: 'bakin_assets', hits: 12, took_ms: 230, budget: 'degraded' },
                      { table: 'bakin_memory', hits: 0, took_ms: 500, budget: 'omitted' },
                    ],
                  }}
                />
              </div>
              <ScoreOverlay
                info={{
                  score: 0.0486,
                  indexScores: { full_text: 0.7549, assets_text: -0.1733, assets_visual: -0.704 },
                  matchedFields: ['title', 'caption'],
                }}
              />
            </section>
          </div>
        </Stack>
      </PageShell>
    </main>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('Search is unavailable')
    await expect(canvas.getByRole('status')).toHaveTextContent('showing basic text matching')
    await expect(canvas.getByRole('note', { name: 'Search relevance details' })).toHaveTextContent('matched: title, caption')
    await userEvent.hover(canvas.getByRole('button', { name: /Partial results/ }))
    await waitFor(() => expect(within(document.body).getByRole('tooltip')).toHaveTextContent('memory: no answer in time'))
  },
} satisfies Story
