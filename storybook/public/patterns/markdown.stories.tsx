import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import { MarkdownContent, MarkdownEditor, type MarkdownEditorMode } from '@makinbakin/sdk/content'
import { SegmentedControl } from '@makinbakin/sdk/patterns'

import './markdown.stories.css'

const meta = {
  title: 'Content/Markdown',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'MarkdownContent is the supported rich-content renderer; MarkdownEditor supplies an explicitly labeled controlled edit/preview surface. Internal navigation delegates to the existing routing link through renderInternalLink.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'reduced-motion', 'dense-data', 'scroll-ownership'],
  },
} satisfies Meta

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

export const ReadingAndCode = {
  render: () => (
    <main className="bakin-markdown-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-markdown-story__intro">
            <p>Content / trusted Markdown</p>
            <h1>Read rich operational content without losing exact evidence</h1>
            <p>Typography, code, tables, managed sections, links, and narrow-width overflow share one supported presentation.</p>
          </header>
          <article aria-label="Release evidence" className="bakin-markdown-story__surface">
            <MarkdownContent
              content={releaseMarkdown}
              renderInternalLink={({ href, children }) => <a href={href}>{children}</a>}
            />
          </article>
        </Stack>
      </PageShell>
    </main>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Release evidence', level: 1 })).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Copy code' })).toHaveLength(2)
    await expect(canvas.getByText('json')).toBeVisible()
    await expect(canvas.getByRole('table')).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Managed section: release' })).toBeVisible()
  },
} satisfies Story

function EditorExample() {
  const [mode, setMode] = useState<MarkdownEditorMode>('edit')
  const [content, setContent] = useState('## Handoff\n\nRelease owner: **Maya**\n\n- [x] Route audit\n- [ ] Final approval')

  return (
    <main className="bakin-markdown-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-markdown-story__intro">
            <p>Content / controlled editor</p>
            <h1>Keep editing controls outside the content contract</h1>
            <p>The host owns mode state and persistence. The editor owns a labeled exact input and canonical preview presentation.</p>
          </header>
          <div className="bakin-markdown-story__file-header">
            <div>
              <h2>RELEASE.md</h2>
              <p>Rendered from the current workspace file.</p>
            </div>
            <SegmentedControl
              ariaLabel="Markdown editor mode"
              options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]}
              value={mode}
              onValueChange={(value) => setMode(value as MarkdownEditorMode)}
            />
          </div>
          <div className="bakin-markdown-story__surface">
            <MarkdownEditor
              label="Release handoff content"
              content={content}
              mode={mode}
              height="compact"
              onChange={setContent}
              description="Changes remain local until the surrounding product action saves them."
            />
          </div>
        </Stack>
      </PageShell>
    </main>
  )
}

export const ControlledEditor = {
  render: () => <EditorExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: 'Release handoff content' })
    await expect(input).toBeVisible()
    await userEvent.click(canvas.getByRole('tab', { name: 'Preview' }))
    await expect(canvas.getByRole('region', { name: 'Release handoff content preview' })).toBeVisible()
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
  },
} satisfies Story
