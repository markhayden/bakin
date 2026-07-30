// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { assignSeriesColors, CompositionBar, type CompositionBarSegment } from '@makinbakin/sdk/charts'

afterEach(cleanup)

const outcomes: CompositionBarSegment[] = [
  { key: 'succeeded', label: 'Succeeded', value: 18 },
  { key: 'failed', label: 'Failed', value: 4 },
  { key: 'canceled', label: 'Canceled', value: 2 },
]

describe('CompositionBar', () => {
  it('carries a complete accessible summary with exact values and percentages', () => {
    render(<CompositionBar label="Task outcomes" data={outcomes} />)

    expect(screen.getByRole('img', {
      name: 'Task outcomes: Succeeded 18 (75%), Failed 4 (17%), Canceled 2 (8%)',
    })).toBeTruthy()
  })

  it('omits zero-value segments from the strip but keeps them in the accessible output and legend', () => {
    const { container } = render(
      <CompositionBar
        label="Run outcomes"
        data={[
          { key: 'succeeded', label: 'Succeeded', value: 12 },
          { key: 'failed', label: 'Failed', value: 0 },
          { key: 'canceled', label: 'Canceled', value: 3 },
        ]}
      />,
    )

    expect(container.querySelector('[data-segment-key="failed"]')).toBeNull()
    expect(container.querySelectorAll('[data-slot="composition-bar-segment"]')).toHaveLength(2)
    expect(screen.getByRole('img', {
      name: 'Run outcomes: Succeeded 12 (80%), Failed 0 (0%), Canceled 3 (20%)',
    })).toBeTruthy()
    const legend = screen.getByRole('list', { name: 'Run outcomes legend' })
    expect(legend.textContent).toContain('Failed')
    expect(legend.textContent).toContain('0')
  })

  it('assigns fixed palette slots against the sorted full key set and honors explicit colors', () => {
    const data: CompositionBarSegment[] = [
      { key: 'zeta', label: 'Zeta', value: 5 },
      { key: 'alpha', label: 'Alpha', value: 3 },
      { key: 'mango', label: 'Mango', value: 2, color: 'var(--bakin-color-signal-danger)' },
    ]
    const assigned = assignSeriesColors(data.map((segment) => segment.key))
    const { container } = render(<CompositionBar label="Mixed keys" data={data} />)

    const segment = (key: string) =>
      container.querySelector<HTMLElement>(`[data-segment-key="${key}"]`)!.style.backgroundColor
    expect(segment('zeta')).toBe(assigned.get('zeta')!)
    expect(segment('alpha')).toBe(assigned.get('alpha')!)
    expect(segment('mango')).toBe('var(--bakin-color-signal-danger)')
  })

  it('makes default-size segments keyboard-focusable and mirrors focus in the shared tooltip', () => {
    render(<CompositionBar label="Task outcomes" data={outcomes} />)

    const segment = screen.getByRole('img', { name: 'Succeeded 18 (75%)' })
    expect(segment.getAttribute('tabindex')).toBe('0')
    fireEvent.focus(segment)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toBe('Succeeded 18 (75%)')
    expect(segment.getAttribute('aria-describedby')).toBe(tooltip.id)
    fireEvent.blur(segment)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('renders inline as a single labelled img with no per-segment targets and no legend', () => {
    const { container } = render(
      <CompositionBar label="Token mix" size="inline" legend data={outcomes} />,
    )

    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(container.querySelector('[data-slot="composition-bar-segment"][tabindex]')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Token mix legend' })).toBeNull()
  })

  it('formats exact values through formatValue in both the summary and the legend', () => {
    render(
      <CompositionBar
        label="Session token mix"
        formatValue={(value) => `${Math.round(value / 1000)}k`}
        data={[
          { key: 'input', label: 'Input', value: 400_000 },
          { key: 'output', label: 'Output', value: 100_000 },
        ]}
      />,
    )

    expect(screen.getByRole('img', { name: 'Session token mix: Input 400k (80%), Output 100k (20%)' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Session token mix legend' }).textContent).toContain('400k')
  })

  it('suppresses the legend when disabled at the default size', () => {
    render(<CompositionBar label="Task outcomes" legend={false} data={outcomes} />)
    expect(screen.queryByRole('list', { name: 'Task outcomes legend' })).toBeNull()
  })

  it('names an empty dataset honestly instead of inventing segments', () => {
    const { container } = render(
      <CompositionBar label="Latest-session traffic" data={[]} emptyLabel="No traffic reported." />,
    )

    expect(screen.getByRole('img', { name: 'Latest-session traffic: No traffic reported.' })).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="composition-bar-segment"]')).toHaveLength(0)
    expect(screen.getByText('No traffic reported.')).toBeTruthy()
  })

  it('treats non-finite and negative values as zero without dropping them from the record', () => {
    const { container } = render(
      <CompositionBar
        label="Guarded values"
        data={[
          { key: 'good', label: 'Good', value: 10 },
          { key: 'bad', label: 'Bad', value: -5 },
          { key: 'broken', label: 'Broken', value: Number.NaN },
        ]}
      />,
    )

    expect(container.querySelectorAll('[data-slot="composition-bar-segment"]')).toHaveLength(1)
    expect(screen.getByRole('img', {
      name: 'Guarded values: Good 10 (100%), Bad 0 (0%), Broken 0 (0%)',
    })).toBeTruthy()
  })
})
