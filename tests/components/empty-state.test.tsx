// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Settings } from 'lucide-react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-empty-state-${Date.now()}`)

vi.mock('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { EmptyState } from '@/components/empty-state'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No tasks found" />)
    expect(screen.getByRole('heading', { name: 'No tasks found' })).toBeDefined()
  })

  it('renders the description when provided', () => {
    render(
      <EmptyState
        title="No assets found"
        description="Agents will create assets here as they complete tasks."
      />,
    )
    expect(screen.getByText(/Agents will create assets/)).toBeDefined()
  })

  it('omits description when absent', () => {
    const { container } = render(<EmptyState title="No tasks" />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('renders a lucide icon wrapped in a circle', () => {
    const { container } = render(<EmptyState icon={Settings} title="No plugin settings" />)
    expect(container.querySelector('svg')).toBeDefined()
    expect(container.querySelector('.rounded-full')).toBeDefined()
  })

  it('renders the action slot', () => {
    render(
      <EmptyState title="No teams yet." action={<button>Create team</button>} />,
    )
    expect(screen.getByRole('button', { name: /create team/i })).toBeDefined()
  })

  it('uses centered column layout', () => {
    const { container } = render(<EmptyState title="No data" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('text-center')
    expect(root.className).toContain('flex-col')
  })
})
