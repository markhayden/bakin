/**
 * Tests for the shared ErrorBanner component.
 *
 * Contract:
 *   1. Renders the given message.
 *   2. Shows an AlertCircle icon.
 *   3. Omits the retry button when onRetry is undefined.
 *   4. Renders a retry button that invokes onRetry when provided.
 *   5. Uses destructive styling (border-destructive/20, bg-destructive/10).
 */
// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-error-banner-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { ErrorBanner } from '@/components/error-banner'

describe('ErrorBanner', () => {
  it('renders the message', () => {
    render(<ErrorBanner message="Something failed" />)
    expect(screen.getByText('Something failed')).toBeDefined()
  })

  it('omits the retry button when onRetry is absent', () => {
    render(<ErrorBanner message="oops" />)
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = mock()
    render(<ErrorBanner message="oops" onRetry={onRetry} />)
    const btn = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(btn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('uses danger styling on the container', () => {
    const { container } = render(<ErrorBanner message="oops" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('border-bakin-signal-danger')
    expect(root.className).toContain('bg-bakin-signal-danger')
  })
})
