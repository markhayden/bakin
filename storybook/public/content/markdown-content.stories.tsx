import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { MarkdownContent } from '@makinbakin/sdk/content'

import { StoryStage } from '../../support'

const meta = {
  title: 'Components/Content/MarkdownContent',
  component: MarkdownContent,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'MarkdownContent is the supported rich-content renderer for trusted Markdown: typography, copyable code blocks with visible language, tables that own their horizontal overflow, visibly identified Bakin-managed sections, and safe link behavior. Internal navigation delegates to the existing routing link through `renderInternalLink` — the renderer never touches the URL.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'dense-data', 'scroll-ownership'],
  },
} satisfies Meta<typeof MarkdownContent>

export default meta
type Story = StoryObj<typeof meta>

const releaseMarkdown = `# Release evidence

The **routing contract** remains authoritative. Internal links should use the consumer's established route link; external links retain safe browser behavior.

## Verification

- Keep query state in the URL.
- Preserve exact tool evidence.
- Make degraded behavior visible.

\`\`\`typescript
const route = defineRoute({ path: '/reviews/$reviewId' })
const reviewId = route.useParams().reviewId
\`\`\`

\`\`\`json
{
  "state": "ready",
  "checks": 268,
  "degraded": false
}
\`\`\`

| Check | Result | Owner |
| --- | --- | --- |
| Public routes | 268 passed | Release |
| Narrow layout | Passed | UI systems |
| Accessibility | Passed | UI systems |

<!-- bakin:release:start -->
This section is projector-managed and remains visibly identified.
<!-- bakin:release:end -->`

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { content: '# Release notes\n\nThe **routing contract** remains authoritative.' },
  argTypes: {
    content: { control: 'text' },
    compareTo: { control: 'text' },
    // Internal links delegate to the consumer's routing link.
    renderInternalLink: { control: false },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Release notes', level: 1 })).toBeVisible()
    await expect(canvas.getByText('routing contract')).toBeVisible()
  },
} satisfies Story

const comparisonBefore = '# Project plan\n\n## Goal\n\nAn old goal.\n\n## Tasks\n\n- First task\n  - Nested detail\n- Second task\n\n| Day | Place |\n| --- | --- |\n| Saturday | Old park |\n\n```ts\nconst ready = false\n```\n\n[Project reference][project]\n\n[project]: /projects/old\n\nRemoved closing note.'
const comparisonAfter = comparisonBefore.replace('An old goal.', 'An updated goal.').replace('Second task', 'Replacement task').replace('Old park', 'New park').replace('false', 'true').replace('/projects/old', '/projects/current').replace('\n\nRemoved closing note.', '')

export const WholeDocumentComparison = {
  args: { content: comparisonAfter, compareTo: comparisonBefore },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { name: 'Goal', level: 2 })).toBeVisible()
    await expect(canvas.getByRole('table')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Project reference' })).toHaveAttribute('href', '/projects/current')
    await expect(canvasElement.querySelectorAll('[data-md-changed-block]')).toHaveLength(5)
    await expect(canvas.getAllByText(/removed from the previous version/).length).toBeGreaterThan(0)
  },
} satisfies Story

export const DeletedDocument = {
  args: { content: '', compareTo: 'A removed paragraph.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('1 block removed from the previous version.')).toBeVisible()
  },
} satisfies Story

export const ReadingAndCode = {
  // Type-satisfying only: the showcase owns its content.
  args: { content: releaseMarkdown },
  render: () => (
    <StoryStage
      eyebrow="Content / trusted Markdown"
      title="Read rich operational content without losing exact evidence"
      description="Typography, code, tables, managed sections, links, and narrow-width overflow share one supported presentation."
    >
      <article
        aria-label="Release evidence"
        style={{
          minWidth: 0,
          maxWidth: '52rem',
          padding: 'var(--bakin-layout-space-6)',
          border: '1px solid var(--bakin-color-border-subtle)',
          borderRadius: 'var(--bakin-radius-overlay)',
          background: 'var(--bakin-color-surface-default)',
        }}
      >
        <MarkdownContent
          content={releaseMarkdown}
          renderInternalLink={({ href, children }) => <a href={href}>{children}</a>}
        />
      </article>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Release evidence', level: 1 })).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Copy code' })).toHaveLength(2)
    await expect(canvas.getByText('json')).toBeVisible()
    await expect(canvas.getByRole('table')).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Managed section: release' })).toBeVisible()
  },
} satisfies Story

export const ManagedDocumentContext = {
  args: {
    content: '[Outside reference][inside]\n\n<!-- bakin:plan:start -->\n\n## Managed plan\n\n- [Inside reference][outside]\n  - Nested task\n\n[inside]: /projects/inside\n\n<!-- bakin:plan:end -->\n\n[outside]: /projects/outside\n\n```html\n<!-- bakin:literal:start -->\n<p>Code stays code</p>\n<!-- bakin:literal:end -->\n```',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Outside reference' })).toHaveAttribute('href', '/projects/inside')
    await expect(canvas.getByRole('link', { name: 'Inside reference' })).toHaveAttribute('href', '/projects/outside')
    await expect(canvas.getByRole('region', { name: 'Managed section: plan' })).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'Managed section: literal' })).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Copy code' })).toBeVisible()
  },
} satisfies Story
