// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-status-badge')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { StatusBadge } from '@makinbakin/sdk/patterns'

afterEach(() => cleanup())

function StubIcon({ className }: { className?: string }) {
  return <svg data-testid="badge-icon" className={className} />
}

describe('StatusBadge', () => {
  it('renders children with the tone marker (default neutral)', () => {
    render(<StatusBadge>Draft</StatusBadge>)
    expect(screen.getByText('Draft')).toBeDefined()
    expect(document.querySelector('[data-status-badge="neutral"]')).not.toBeNull()
  })

  it('each tone stamps its data attribute', () => {
    for (const tone of ['success', 'attention', 'danger', 'accent'] as const) {
      const { unmount } = render(<StatusBadge tone={tone}>x</StatusBadge>)
      expect(document.querySelector(`[data-status-badge="${tone}"]`)).not.toBeNull()
      unmount()
    }
  })

  it('renders the optional icon', () => {
    render(<StatusBadge tone="success" icon={StubIcon}>Published</StatusBadge>)
    expect(screen.getByTestId('badge-icon')).toBeDefined()
  })
})
