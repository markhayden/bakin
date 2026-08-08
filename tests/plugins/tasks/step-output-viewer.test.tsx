// @vitest-environment jsdom

import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { StepOutputViewer } from '../../../plugins/tasks/components/step-output-viewer'

describe('StepOutputViewer', () => {
  it('renders normalized output as semantic nested key/value content', () => {
    const { container } = render(
      <StepOutputViewer
        output={{
          summary: 'Approved for launch',
          metrics: { itemCount: 3, ready: true },
        }}
      />,
    )

    // The kit Panel owns the scrollable boundary; the semantic dl lives inside.
    const panel = container.querySelector('[data-step-output]')
    expect(panel?.getAttribute('data-slot')).toBe('panel')
    expect(panel?.querySelector('dl')).not.toBeNull()
    expect(screen.getByText('Summary')).toBeTruthy()
    expect(screen.getByText('Approved for launch')).toBeTruthy()
    expect(screen.getByText('Item Count')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('true')).toBeTruthy()
  })

  it('normalizes plain string output without exposing a raw JSON surface', () => {
    const { container } = render(<StepOutputViewer output="Ready to publish" />)

    expect(screen.getByText('Output')).toBeTruthy()
    expect(screen.getByText('Ready to publish')).toBeTruthy()
    expect(container.querySelector('pre')).toBeNull()
  })
})
