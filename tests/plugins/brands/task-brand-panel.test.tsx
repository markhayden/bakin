// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'

mock.module('@makinbakin/sdk/hooks', () => ({
  useDebug: () => [false],
  useJsonFetch: (url: string | null) => {
    if (url?.includes('task-context')) {
      return {
        data: {
          brand: {
            brandId: 'harvest-and-hearth',
            name: 'Harvest & Hearth',
            source: 'project',
            blocked: true,
          },
        },
      }
    }
    return {
      data: {
        injections: [{
          ts: '2026-07-24T12:00:00.000Z',
          agent: 'pixel',
          cardBytes: 1280,
          lessonsIncluded: ['launch.md'],
          omitted: [{ item: 'voice.md', reason: 'budget' }],
        }],
      },
    }
  },
}))

mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to, ...props }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

import { TaskBrandPanel } from '../../../plugins/brands/components/task-brand-panel'

afterEach(() => {
  cleanup()
  mock.restore()
})

describe('TaskBrandPanel', () => {
  it('uses the canonical drawer hierarchy and feedback controls', async () => {
    globalThis.fetch = mock(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    render(<TaskBrandPanel taskId="task-1" />)

    expect(document.querySelector('[data-slot="bakin-drawer-section"]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Brand context' })).toBeDefined()
    expect(document.querySelector('[data-slot="banner"][data-tone="attention"]')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Open brand' }).getAttribute('href')).toBe('/brands/harvest-and-hearth')

    fireEvent.click(screen.getByRole('button', { name: 'Save as brand lesson' }))
    expect(document.querySelector('[data-slot="input"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="textarea"]')).not.toBeNull()

    fireEvent.change(screen.getByLabelText(/Lesson title/), { target: { value: 'Prefer concrete copy' } })
    fireEvent.change(screen.getByLabelText(/Lesson guidance/), { target: { value: 'State the exact outcome and next action.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled()
      expect(screen.getByText(/Lesson saved/)).toBeDefined()
    })
    await settleReact()
  })
})
