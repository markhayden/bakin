import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@makinbakin/sdk/ui'

const meta = {
  title: 'Foundation/Button',
  component: Button,
  tags: ['public'],
  args: {
    children: 'Continue',
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default = {} satisfies Story
