import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import { Input, Label } from '@makinbakin/sdk/ui'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/Label',
  component: Label,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Label names a native or SDK control through htmlFor. Requirement indicators and descriptions are separate copy; never rely on placeholder text as the label.' } },
    bakinCoverage: ['desktop', 'mobile-320'],
  },
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <div>
      <Label htmlFor="project-name">Project name</Label>
      <Input id="project-name" placeholder="Q3 launch" />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText('Project name')
    await userEvent.click(canvas.getByText('Project name'))
    await expect(input).toHaveFocus()
  },
} satisfies Story

export const Association = {
  render: () => (
    <StoryStage
      eyebrow="Form semantics"
      title="Label"
      description="Clicking the visible name moves focus to its control."
    >
      <StorySection title="Visible association">
        <div style={{ maxWidth: '24rem' }}>
          <Stack gap="dense">
            <StoryCluster>
              <Label htmlFor="label-project-name">Project name</Label>
              <span className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">Required</span>
            </StoryCluster>
            <p className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted" id="label-project-description">Use the name operators recognize in search.</p>
            <Input id="label-project-name" required aria-describedby="label-project-description" placeholder="Q3 launch" />
          </Stack>
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText('Project name')
    await expect(input).toHaveAccessibleDescription('Use the name operators recognize in search.')
    await userEvent.click(canvas.getByText('Project name'))
    await expect(input).toHaveFocus()
  },
} satisfies Story
