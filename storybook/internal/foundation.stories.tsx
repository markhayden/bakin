import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@makinbakin/sdk/ui'

const meta = {
  title: 'Internal/Foundation/Button',
  component: Button,
  args: {
    children: 'Continue',
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default = {} satisfies Story
