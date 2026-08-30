import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { MarkdownEditor, type MarkdownEditorMode } from '@makinbakin/sdk/content'
import { SegmentedControl } from '@makinbakin/sdk/patterns'

import { StoryStage } from '../../support'

const meta = {
  title: 'Components/Content/MarkdownEditor',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'MarkdownEditor supplies an explicitly labeled controlled edit/preview surface: the host owns `mode` state and persistence while the editor owns a labeled exact input and the canonical MarkdownContent preview. Heights are semantic (`compact`, `document`, `viewport`, `fill`), and preview internal links delegate to the existing routing link through `renderInternalLink`.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'reduced-motion'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <div style={{ width: 'min(100%, 36rem)' }}>
      <MarkdownEditor
        label="Release notes"
        content={'## Handoff\n\nRelease owner: **Maya**'}
        mode="edit"
        height="compact"
        onChange={() => {}}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Release notes' })
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('## Handoff\n\nRelease owner: **Maya**')
  },
} satisfies Story

function EditorExample() {
  const [mode, setMode] = useState<MarkdownEditorMode>('edit')
  const [content, setContent] = useState('## Handoff\n\nRelease owner: **Maya**\n\n- [x] Route audit\n- [ ] Final approval')

  return (
    <StoryStage
      eyebrow="Content / controlled editor"
      title="Keep editing controls outside the content contract"
      description="The host owns mode state and persistence. The editor owns a labeled exact input and canonical preview presentation."
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--bakin-layout-gap-item)',
          maxWidth: '52rem',
          paddingBottom: 'var(--bakin-layout-space-4)',
          borderBottom: '1px solid var(--bakin-color-border-subtle)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--bakin-typography-size-section-title)', fontWeight: 'var(--bakin-typography-weight-semibold)' }}>
            RELEASE.md
          </h2>
          <p style={{ margin: 'var(--bakin-layout-space-1) 0 0', color: 'var(--bakin-color-text-muted)' }}>
            Rendered from the current workspace file.
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Markdown editor mode"
          options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]}
          value={mode}
          onValueChange={(value) => setMode(value as MarkdownEditorMode)}
        />
      </div>
      <div style={{ minWidth: 0, maxWidth: '52rem' }}>
        <MarkdownEditor
          label="Release handoff content"
          content={content}
          mode={mode}
          height="compact"
          onChange={setContent}
          description="Changes remain local until the surrounding product action saves them."
        />
      </div>
    </StoryStage>
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
