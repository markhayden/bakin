// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  Avatar,
  AvatarFallback,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Separator,
  Skeleton,
} from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('Avatar public contract', () => {
  it('normalizes the legacy default size and renders a text fallback', () => {
    render(<Avatar size="default"><AvatarFallback>MB</AvatarFallback></Avatar>)
    const fallback = screen.getByText('MB')
    expect(fallback.closest('[data-slot="avatar"]')?.getAttribute('data-size')).toBe('md')
    expect(fallback.closest('[data-slot="avatar"]')?.className).toContain('size-bakin-8')
  })

  it('supports the complete canonical size vocabulary', () => {
    render(<Avatar size="xl" data-testid="avatar"><AvatarFallback>XL</AvatarFallback></Avatar>)
    expect(screen.getByTestId('avatar').getAttribute('data-size')).toBe('xl')
  })
})

describe('Card public contract', () => {
  it('provides one token-backed bounded-object surface and canonical subparts', () => {
    render(
      <Card aria-labelledby="task-title">
        <CardHeader>
          <CardTitle id="task-title">Quarterly launch</CardTitle>
          <CardDescription>Persistent work with a clear boundary.</CardDescription>
        </CardHeader>
        <CardContent>12 linked assets</CardContent>
      </Card>,
    )

    const card = screen.getByText('Quarterly launch').closest('[data-slot="card"]')
    expect(card?.getAttribute('data-size')).toBe('md')
    expect(card?.className).toContain('bg-bakin-surface-default')
    expect(card?.className).toContain('border-bakin-border-subtle')
    expect(card?.querySelector('[data-slot="card-content"]')).not.toBeNull()
  })

  it('keeps the legacy default size as a compatibility alias', () => {
    render(<Card size="default" data-testid="card">Object</Card>)
    expect(screen.getByTestId('card').getAttribute('data-size')).toBe('md')
  })
})

describe('Separator public contract', () => {
  it('is decorative by default and semantic only when requested', () => {
    const { rerender } = render(<Separator data-testid="separator" />)
    const separator = screen.getByTestId('separator')
    expect(separator.getAttribute('aria-hidden')).toBe('true')
    expect(separator.getAttribute('role')).toBe('presentation')

    rerender(<Separator decorative={false} orientation="vertical" />)
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('vertical')
  })
})

describe('Skeleton public contract', () => {
  it('is silent, reduced-motion-safe loading presentation', () => {
    render(<Skeleton shape="text" data-testid="skeleton" />)
    const skeleton = screen.getByTestId('skeleton')
    expect(skeleton.getAttribute('aria-hidden')).toBe('true')
    expect(skeleton.getAttribute('data-shape')).toBe('text')
    expect(skeleton.className).toContain('motion-reduce:animate-none')
  })
})

describe('Collapsible public contract', () => {
  it('owns disclosure state and keyboard-operable relationships', () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Advanced options</CollapsibleTrigger>
        <CollapsibleContent>Retry limit</CollapsibleContent>
      </Collapsible>,
    )

    const trigger = screen.getByRole('button', { name: 'Advanced options' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Retry limit')).toBeDefined()
    expect(trigger.getAttribute('aria-controls')).toBeTruthy()
  })
})
