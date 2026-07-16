// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-section-card')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { SectionCard } from '../../src/components/section-card'

afterEach(() => cleanup())

function StubIcon({ className }: { className?: string }) {
  return <svg data-testid="section-icon" className={className} />
}

describe('SectionCard', () => {
  it('renders title, description, and children', () => {
    render(
      <SectionCard title="Palette" description="Agents pull these exact values into everything they generate.">
        <p>rows</p>
      </SectionCard>,
    )
    expect(screen.getByText('Palette')).toBeDefined()
    expect(screen.getByText(/exact values/)).toBeDefined()
    expect(screen.getByText('rows')).toBeDefined()
    expect(document.querySelector('[data-section-card]')).not.toBeNull()
  })

  it('gives the title and explanation enough visual weight to scan', () => {
    render(
      <SectionCard title="Search readiness" description="Can Bakin find existing information and save new changes?">
        <p>Ready</p>
      </SectionCard>,
    )

    const title = screen.getByText('Search readiness').closest('[data-slot="card-title"]')
    const description = screen.getByText(/Can Bakin find/)

    expect(title?.className).toContain('text-base')
    expect(title?.className).toContain('font-semibold')
    expect(description.className).toContain('text-sm')
    expect(description.className).toContain('leading-relaxed')
    expect(description.className).not.toContain('text-muted-foreground/80')
  })

  it('renders the icon and header action when provided', () => {
    render(
      <SectionCard title="Logos" icon={StubIcon} action={<button>Add logo</button>}>
        <div />
      </SectionCard>,
    )
    expect(screen.getByTestId('section-icon')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add logo' })).toBeDefined()
  })

  it('omits the description node when not given', () => {
    render(
      <SectionCard title="Terms">
        <div />
      </SectionCard>,
    )
    expect(document.querySelector('[data-slot=card-description]')).toBeNull()
  })
})
