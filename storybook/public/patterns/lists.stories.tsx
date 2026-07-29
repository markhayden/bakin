import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react'
import { expect } from 'storybook/test'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import { ListRow, ListRows, StatusBadge } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

import './lists.stories.css'

const meta = {
  title: 'Patterns/Lists',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ListRows and ListRow provide the three sanctioned visual relationships for repeated content. Use bordered rows for interactive resources and nested details, separated rows for a dense continuous log, and plain rows only when surrounding hierarchy already makes each item unambiguous. Consumers own domain content and actions; the pattern owns semantics, spacing, and boundaries.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'dense-data', 'non-color'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function ListPattern({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="bakin-lists-story__section" aria-labelledby={`list-${title.toLowerCase()}`}>
      <header>
        <h2 id={`list-${title.toLowerCase()}`}>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  )
}

function ListVarietiesExample() {
  return (
    <main className="bakin-lists-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-lists-story__intro">
            <p>Repeated content / row relationships</p>
            <h1>Choose one list boundary and keep it consistent</h1>
            <p>
              Boundaries communicate how records relate. Choose the lightest sanctioned
              treatment that still makes the list immediately understandable.
            </p>
          </header>

          <ListPattern
            title="Bordered"
            description="Default for interactive resources, settings, and expandable nested details. Every row is a complete object."
          >
            <ListRows aria-label="Bordered lesson rows">
              <ListRow className="bakin-lists-story__row">
                <span className="bakin-lists-story__identity">
                  <FileText aria-hidden="true" />
                  <span>
                    <strong>brand-color-grade</strong>
                    <small>Brand color grade · style, images</small>
                  </span>
                </span>
                <span className="bakin-lists-story__actions">
                  <StatusBadge tone="success">Active</StatusBadge>
                  <Button size="sm" variant="outline">Open</Button>
                </span>
              </ListRow>
              <ListRow className="bakin-lists-story__row">
                <span className="bakin-lists-story__identity">
                  <AlertTriangle aria-hidden="true" />
                  <span>
                    <strong>Health endpoint failure</strong>
                    <small>Endpoint not found (HTTP 404).</small>
                  </span>
                </span>
                <span className="bakin-lists-story__actions">
                  <StatusBadge tone="danger">Failed</StatusBadge>
                  <time dateTime="2026-07-26T21:38:03-06:00">9:38 PM</time>
                </span>
              </ListRow>
            </ListRows>
          </ListPattern>

          <ListPattern
            title="Separated"
            description="For dense logs and scan tables where rows form one continuous result set rather than separate objects."
          >
            <ListRows aria-label="Separated activity rows" variant="separated">
              <ListRow className="bakin-lists-story__row">
                <span className="bakin-lists-story__identity">
                  <CheckCircle2 aria-hidden="true" />
                  <span>
                    <strong>Catalog refreshed</strong>
                    <small>24 records indexed without errors</small>
                  </span>
                </span>
                <time dateTime="2026-07-26T21:36:00-06:00">9:36 PM</time>
              </ListRow>
              <ListRow className="bakin-lists-story__row">
                <span className="bakin-lists-story__identity">
                  <CheckCircle2 aria-hidden="true" />
                  <span>
                    <strong>Agent package synced</strong>
                    <small>Managed content matches the installed package</small>
                  </span>
                </span>
                <time dateTime="2026-07-26T21:31:00-06:00">9:31 PM</time>
              </ListRow>
            </ListRows>
          </ListPattern>

          <ListPattern
            title="Plain"
            description="For short supporting facts where a section heading already establishes the relationship. Do not use it for interactive records."
          >
            <ListRows aria-label="Plain supporting facts" variant="plain">
              <ListRow className="bakin-lists-story__fact">
                <span>Source</span>
                <strong>Runtime</strong>
              </ListRow>
              <ListRow className="bakin-lists-story__fact">
                <span>Current version</span>
                <strong>v2</strong>
              </ListRow>
            </ListRows>
          </ListPattern>
        </Stack>
      </PageShell>
    </main>
  )
}

export const ListVarieties = {
  render: () => <ListVarietiesExample />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'Bordered lesson rows' })).toHaveAttribute('data-variant', 'bordered')
    await expect(canvas.getByRole('list', { name: 'Separated activity rows' })).toHaveAttribute('data-variant', 'separated')
    await expect(canvas.getByRole('list', { name: 'Plain supporting facts' })).toHaveAttribute('data-variant', 'plain')
    await expect(canvas.getAllByRole('listitem')).toHaveLength(6)
  },
} satisfies Story
