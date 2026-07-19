import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, buttonVariants } from '@makinbakin/sdk/ui'
import { useEffect, useState } from 'react'
import { expect } from 'storybook/test'

import './primitives.stories.css'

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
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Use Button for actions. Choose intent with `variant`, hierarchy with placement, and the smallest size that still preserves a 24px target. `default`, `destructive`, and `icon` remain migration aliases; new code should use `primary`, `danger`, and `icon-md`.',
      },
    },
  },
  args: {
    children: 'Continue',
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default = {
  render: (args) => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Action primitive</p>
        <h1>Button</h1>
        <p>One semantic action vocabulary for product surfaces and plugins.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <header><h2>Default action</h2><p>Use one primary action per local decision point.</p></header>
        <div className="bakin-primitive-story__cluster"><Button {...args} /></div>
      </section>
    </main>
  ),
} satisfies Story

export const Variants = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Intent</p>
        <h1>Action hierarchy</h1>
        <p>Primary and danger are deliberate decisions. Secondary, outline, and ghost support the surrounding hierarchy.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <header><h2>Canonical variants</h2><p>Labels carry meaning; color reinforces it and never stands alone.</p></header>
        <div className="bakin-primitive-story__cluster">
          <Button variant="primary">Create task</Button>
          <Button variant="secondary">Export</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="ghost">View details</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="warning">Pause runs</Button>
          <Button variant="accent">Open signal</Button>
          <Button variant="link">Learn more</Button>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const Sizes = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Density</p>
        <h1>Purposeful sizes</h1>
        <p>Medium is the Product Character default. Extra-small is reserved for dense operational rows.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <header><h2>Text actions</h2></header>
        <div className="bakin-primitive-story__cluster">
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>
      <section className="bakin-primitive-story__section">
        <header><h2>Icon targets</h2><p>Icon-only actions always need an accessible name.</p></header>
        <div className="bakin-primitive-story__cluster">
          {(['icon-xs', 'icon-sm', 'icon-md', 'icon-lg'] as const).map((size) => (
            <Button key={size} size={size} variant="outline" aria-label={`Add with ${size}`}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </Button>
          ))}
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const States = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">State</p>
        <h1>Interaction states</h1>
        <p>Keyboard focus is explicit; disabled and invalid states remain semantic.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <div className="bakin-primitive-story__cluster">
          <Button>Enabled</Button>
          <Button disabled>Disabled</Button>
          <Button aria-invalid="true" variant="outline">Invalid action</Button>
          <Button aria-expanded="true" variant="secondary">Expanded</Button>
          <a href="#button-helper" className={buttonVariants({ variant: 'outline', size: 'md' })}>Styled link</a>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const BehaviorFixture = {
  render: () => <ButtonBehaviorFixture />,
  parameters: { layout: 'centered' },
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
