// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Progress,
  ProgressLabel,
  ProgressValue,
  badgeVariants,
  buttonVariants,
} from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('Button public contract', () => {
  it('uses the canonical primary, medium contract by default', () => {
    render(<Button>Continue</Button>)
    const button = screen.getByRole('button', { name: 'Continue' })

    expect(button.getAttribute('data-variant')).toBe('primary')
    expect(button.getAttribute('data-size')).toBe('md')
    expect(button.className).toContain('bg-bakin-action-primary-background')
    expect(button.className).toContain('focus-visible:outline-bakin-focus-ring')
  })

  it('normalizes legacy aliases without removing current consumer support', () => {
    const { rerender } = render(<Button variant="default" size="default">Save</Button>)
    let button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('data-variant')).toBe('primary')
    expect(button.getAttribute('data-size')).toBe('md')

    rerender(<Button variant="destructive" size="icon" aria-label="Delete" />)
    button = screen.getByRole('button', { name: 'Delete' })
    expect(button.getAttribute('data-variant')).toBe('danger')
    expect(button.getAttribute('data-size')).toBe('icon-md')
  })

  it('retains native activation and disabled semantics', () => {
    let activations = 0
    const { rerender } = render(<Button onClick={() => { activations += 1 }}>Run</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(activations).toBe(1)

    rerender(<Button disabled onClick={() => { activations += 1 }}>Run</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(activations).toBe(1)
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps the supported style helper token-backed', () => {
    expect(buttonVariants({ variant: 'primary', size: 'md' })).toContain('bg-bakin-action-primary-background')
    expect(buttonVariants({ variant: 'danger' })).toContain('border-bakin-signal-danger')
  })
})

describe('Badge public contract', () => {
  it('separates semantic tone from visual treatment and size', () => {
    render(<Badge tone="attention" variant="outline" size="md">Needs review</Badge>)
    const badge = screen.getByText('Needs review')

    expect(badge.getAttribute('data-tone')).toBe('attention')
    expect(badge.getAttribute('data-variant')).toBe('outline')
    expect(badge.getAttribute('data-size')).toBe('md')
    expect(badge.className).toContain('border-bakin-signal-highlight')
  })

  it('normalizes existing variant aliases through the compatibility layer', () => {
    render(<Badge variant="destructive">Blocked</Badge>)
    const badge = screen.getByText('Blocked')

    expect(badge.getAttribute('data-tone')).toBe('danger')
    expect(badge.getAttribute('data-variant')).toBe('soft')
    expect(badgeVariants({ variant: 'secondary' })).toContain('text-bakin-text-muted')
  })
})

describe('Alert public contract', () => {
  it('uses polite status semantics for non-urgent notices', () => {
    render(
      <Alert tone="success">
        <AlertTitle>Saved</AlertTitle>
        <AlertDescription>Your changes are live.</AlertDescription>
      </Alert>,
    )

    const alert = screen.getByRole('status')
    expect(alert.getAttribute('data-tone')).toBe('success')
    expect(screen.getByText('Saved')).toBeDefined()
    expect(screen.getByText('Your changes are live.')).toBeDefined()
  })

  it('uses assertive alert semantics for danger and honors an explicit role', () => {
    const { rerender } = render(<Alert tone="danger">Connection failed</Alert>)
    expect(screen.getByRole('alert').getAttribute('data-tone')).toBe('danger')

    rerender(<Alert tone="danger" role="status">Previously reported failure</Alert>)
    expect(screen.getByRole('status')).toBeDefined()
  })
})

describe('Progress public contract', () => {
  it('exposes an accessible determinate value with canonical tone and size', () => {
    render(
      <Progress value={42} tone="accent" size="md">
        <ProgressLabel>Migration</ProgressLabel>
        <ProgressValue />
      </Progress>,
    )

    const progress = screen.getByRole('progressbar', { name: 'Migration' })
    expect(progress.getAttribute('aria-valuenow')).toBe('42')
    expect(progress.getAttribute('data-tone')).toBe('accent')
    expect(progress.getAttribute('data-size')).toBe('md')
    expect(screen.getByText('42%')).toBeDefined()
  })

  it('announces indeterminate progress without inventing a numeric value', () => {
    render(<Progress value={null} aria-label="Loading workspace" />)
    const progress = screen.getByRole('progressbar', { name: 'Loading workspace' })

    expect(progress.hasAttribute('aria-valuenow')).toBe(false)
    expect(progress.getAttribute('aria-valuetext')).toBe('indeterminate progress')
    expect(progress.getAttribute('data-status')).toBe('indeterminate')
  })
})
