import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@makinbakin/sdk/ui'
import { useEffect, useState } from 'react'
import { expect } from 'storybook/test'

const seededFailure = import.meta.env.VITE_BAKIN_UI_STORY_SEED_FAILURE

function ButtonBehaviorFixture() {
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    if (seededFailure === 'console') console.error('Seeded Storybook console failure')
  }, [])

  return (
    <div style={seededFailure === 'overflow' ? { width: 'calc(100vw + 32px)' } : undefined}>
      <Button
        onClick={() => setActivated(true)}
        onFocus={(event) => {
          if (seededFailure === 'focus') event.currentTarget.blur()
        }}
        onKeyDown={(event) => {
          if (seededFailure === 'keyboard' && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
          }
        }}
      >
        Continue
      </Button>
      {seededFailure === 'axe' && <button data-testid="seeded-unnamed-button" />}
      <p role="status">{activated ? 'Activated' : 'Ready'}</p>
    </div>
  )
}

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

export const BehaviorFixture = {
  render: () => <ButtonBehaviorFixture />,
} satisfies Story

export const Behavior = {
  ...BehaviorFixture,
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Continue' })
    await userEvent.tab()
    await expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('Activated')
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story
