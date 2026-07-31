import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, buttonVariants } from '@makinbakin/sdk/ui'
import { useEffect, useState } from 'react'
import { expect } from 'storybook/test'

import { StoryCluster, StorySection, StoryStage } from '../../support'

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
  title: 'Primitives/Button',
  component: Button,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Use Button for actions. Choose intent with `variant`, hierarchy with placement, and the smallest size that still preserves a 24px target. Primary green carries affirmative product actions such as Install; the same treatment may remain disabled and labelled Installed after completion. `default`, `destructive`, and `icon` remain migration aliases; new code should use `primary`, `danger`, and `icon-md`.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled', 'non-color', 'overflow'],
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    variant: 'primary',
    children: 'Continue',
  },
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole('button', { name: String(args.children) })
    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('data-variant', args.variant ?? 'primary')
  },
} satisfies Story

export const Variants = {
  render: () => (
    <StoryStage
      eyebrow="Intent"
      title="Action hierarchy"
      description="Primary green carries affirmative actions such as installation. Secondary, outline, and ghost support the surrounding hierarchy."
    >
      <StorySection title="Canonical variants" description="Labels carry meaning; color reinforces it and never stands alone.">
        <StoryCluster>
          <Button variant="primary">Install plugin</Button>
          <Button variant="secondary">Export</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="ghost">View details</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="warning">Pause runs</Button>
          <Button variant="accent">Open signal</Button>
          <Button variant="link">Learn more</Button>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Sizes = {
  render: () => (
    <StoryStage
      eyebrow="Density"
      title="Purposeful sizes"
      description="Medium is the Product Character default. Extra-small is reserved for dense operational rows."
    >
      <StorySection title="Text actions">
        <StoryCluster>
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </StoryCluster>
      </StorySection>
      <StorySection title="Icon targets" description="Icon-only actions always need an accessible name.">
        <StoryCluster>
          {(['icon-xs', 'icon-sm', 'icon-md', 'icon-lg'] as const).map((size) => (
            <Button key={size} size={size} variant="outline" aria-label={`Add with ${size}`}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </Button>
          ))}
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const States = {
  render: () => (
    <StoryStage
      eyebrow="State"
      title="Interaction states"
      description="Keyboard focus is explicit; disabled and invalid states remain semantic."
    >
      <StorySection title="Semantic states">
        <StoryCluster>
          <Button size="xs" variant="primary">Install</Button>
          <Button size="xs" variant="primary" disabled>Installed</Button>
          <Button aria-invalid="true" variant="outline">Invalid action</Button>
          <Button aria-expanded="true" variant="secondary">Expanded</Button>
          <a href="#button-helper" className={buttonVariants({ variant: 'outline', size: 'md' })}>Styled link</a>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Install' })).toHaveAttribute('data-variant', 'primary')
    await expect(canvas.getByRole('button', { name: 'Install' })).toHaveAttribute('data-size', 'xs')
    await expect(canvas.getByRole('button', { name: 'Installed' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Installed' })).toHaveAttribute('data-variant', 'primary')
  },
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
