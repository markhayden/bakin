import type { Meta, StoryObj } from '@storybook/react-vite'
import { Overline, Text } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/Text',
  component: Text,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Supporting copy at a system size and tone. `size` picks the reading vs. supporting scale, `tone="muted"` de-emphasises by colour (never opacity, which fails contrast), and `mono` is for identifiers. Headings stay real heading elements — `globals.css` styles those.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'non-color'],
  },
} satisfies Meta<typeof Text>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    size: 'meta',
    tone: 'muted',
    children: 'Last indexed 4 minutes ago',
  },
  play: async ({ canvas, args }) => {
    // De-emphasis is a colour token, not an opacity fade: the text must still
    // be a real, readable node rather than a partially transparent one.
    const text = canvas.getByText(String(args.children))
    await expect(text).toBeVisible()
    await expect(text).toHaveAttribute('data-tone', 'muted')
  },
} satisfies Story

export const SizesAndTones = {
  render: () => (
    <StoryStage
      eyebrow="Typography primitive"
      title="Text sizes and tones"
      description="Body is the reading size; meta is supporting detail. Muted lowers emphasis with a colour token so contrast holds in both themes."
    >
      <StorySection title="Sizes" description="Two steps only — anything larger is a heading.">
        <StoryCluster>
          <Text size="body">Body — the reading size</Text>
          <Text size="meta">Meta — supporting detail</Text>
        </StoryCluster>
      </StorySection>
      <StorySection title="Tones" description="Muted is a colour, never an opacity fade.">
        <StoryCluster>
          <Text tone="default">Default emphasis</Text>
          <Text tone="muted">Muted emphasis</Text>
        </StoryCluster>
      </StorySection>
      <StorySection title="Weights" description="Use medium or semibold to lift a value out of its label.">
        <StoryCluster>
          <Text weight="regular">Regular</Text>
          <Text weight="medium">Medium</Text>
          <Text weight="semibold">Semibold</Text>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Identifiers = {
  render: () => (
    <StoryStage
      eyebrow="Typography primitive"
      title="Monospaced identifiers"
      description="Ids, hashes, paths, and model names line up when they are monospaced. Pair with meta and muted so the identifier supports the row rather than competing with it."
    >
      <StorySection title="Inline identifier" description="Long values wrap rather than truncate behind a tooltip nobody can reach on touch.">
        <StoryCluster>
          <Text mono size="meta" tone="muted">
            9f2c1ab4e7d05c3f8b6a2e1d4c7f0a93
          </Text>
          <Text mono size="meta" tone="muted">
            ~/.bakin/plugins/explore/dist/client.js
          </Text>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const OverlineLabels = {
  render: () => (
    <StoryStage
      eyebrow="Typography primitive"
      title="Overline"
      description="The small uppercase label that titles a group of fields or a card region. One canonical treatment — an overline is a label, so when the group belongs in the document outline use a real heading instead."
    >
      <StorySection title="Grouping label" description="Sits above the values it names.">
        <div className="grid gap-bakin-1">
          <Overline>Capabilities</Overline>
          <Text size="meta" tone="muted">Web search, browser automation, transcription</Text>
        </div>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story
