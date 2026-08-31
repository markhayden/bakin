import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { CodeBlock } from '@makinbakin/sdk/content'

import { StorySection, StoryStage } from '../../support'

const PAYLOAD = `{
  "type": "text",
  "attempts": 3,
  "cost": 0.47,
  "recovered": true,
  "error": null
}`

const meta = {
  title: 'Components/Content/CodeBlock',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'CodeBlock is the one surface for rendering code and structured data — tool payloads, structured agent messages, manifests, commands. Highlighting belongs to this component rather than to each consumer, so every code surface in the product stays legible and identical instead of drifting into a dozen hand-rolled `pre` blocks. Colors come from the syntax token family, which is contrast-validated as normal text: highlighting must never trade readability for decoration. `language="json"` tokenizes keys, strings, numbers, and keyword literals; any other value renders verbatim, because showing an unknown language plainly is honest and mis-highlighting it is not. Malformed JSON also renders exactly as received rather than being partially mangled — the block never edits what it displays. `wrap` trades horizontal scrolling for wrapped lines, and `copyable` adds the shared copy action for the exact source.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'dense-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <div style={{ inlineSize: '32rem', maxInlineSize: '100%' }}>
      <CodeBlock code={PAYLOAD} language="json" label="Tool payload" copyable />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Every value kind is distinguishable, and the source is exact.
    await expect(canvas.getByText('"type"')).toBeVisible()
    await expect(canvas.getByText('true')).toBeVisible()
    await expect(canvas.getByText('null')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy Tool payload' })).toBeVisible()
  },
} satisfies Story

export const LanguagesAndHonesty = {
  render: () => (
    <StoryStage
      eyebrow="Content / Code"
      title="Highlight what we understand, show the rest plainly"
      description="An unknown language or a malformed payload renders verbatim — the block never edits or half-parses what it displays."
    >
      <StorySection title="JSON" description="Keys, strings, numbers, and keyword literals are tokenized.">
        <CodeBlock code={PAYLOAD} language="json" label="Run receipt" />
      </StorySection>

      <StorySection title="Malformed JSON" description="Renders exactly as received rather than partially highlighted.">
        <CodeBlock code={'{ "unterminated": "value ,\n  "next": 3'} language="json" label="Invalid payload" wrap />
      </StorySection>

      <StorySection title="Plain text" description="No language claimed, so nothing is colored.">
        <CodeBlock code={'bakin agents sync --check copywriter'} label="Command" copyable />
      </StorySection>
    </StoryStage>
  ),
} satisfies Story
