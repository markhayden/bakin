// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { CHART_OTHER_COLOR, CHART_SERIES_COLORS, PieChart } from '@makinbakin/sdk/charts'

import {
  buildPieModel,
  formatPieShare,
  PIE_MAX_SLICES,
  pieSlicePath,
  polarPoint,
  type PieChartDatum,
} from '../../../packages/ui/src/charts/pie-chart'

afterEach(cleanup)

describe('pie geometry', () => {
  it('starts at 12 o\'clock and turns clockwise', () => {
    const top = polarPoint(100, 100, 80, 0)
    expect(top.x).toBeCloseTo(100)
    expect(top.y).toBeCloseTo(20)

    const quarter = polarPoint(100, 100, 80, 0.25)
    expect(quarter.x).toBeCloseTo(180)
    expect(quarter.y).toBeCloseTo(100)

    const half = polarPoint(100, 100, 80, 0.5)
    expect(half.x).toBeCloseTo(100)
    expect(half.y).toBeCloseTo(180)
  })

  it('draws a wedge through the center and an annulus segment with two arcs', () => {
    const wedge = pieSlicePath(100, 100, 80, 0, 0, 0.25)
    expect(wedge.startsWith('M 100 100 L ')).toBe(true)
    expect(wedge.match(/A /g)).toHaveLength(1)
    expect(wedge).toContain(' 0 0 1 ')

    const segment = pieSlicePath(100, 100, 80, 48, 0, 0.25)
    expect(segment.startsWith('M 100 100')).toBe(false)
    expect(segment.match(/A /g)).toHaveLength(2)
  })

  it('sets the large-arc flag only past a half turn', () => {
    expect(pieSlicePath(100, 100, 80, 0, 0, 0.75)).toContain(' 0 1 1 ')
    expect(pieSlicePath(100, 100, 80, 0, 0, 0.5)).toContain(' 0 0 1 ')
  })

  it('never rounds a real share to nothing or everything', () => {
    expect(formatPieShare(0.4)).toBe('40%')
    expect(formatPieShare(1)).toBe('100%')
    expect(formatPieShare(0.004)).toBe('<1%')
    expect(formatPieShare(0.996)).toBe('>99%')
  })
})

describe('buildPieModel', () => {
  it('keeps caller order, assigns fixed palette slots by key, and sums fractions to one', () => {
    const model = buildPieModel([
      { key: 'delta', label: 'Delta', value: 1 },
      { key: 'alpha', label: 'Alpha', value: 9 },
      { key: 'charlie', label: 'Charlie', value: 5 },
    ])

    expect(model.hasNegative).toBe(false)
    expect(model.total).toBe(15)
    expect(model.slices.map((slice) => slice.key)).toEqual(['delta', 'alpha', 'charlie'])
    expect(model.slices.find((slice) => slice.key === 'alpha')?.color).toBe(CHART_SERIES_COLORS[0])
    expect(model.slices.find((slice) => slice.key === 'charlie')?.color).toBe(CHART_SERIES_COLORS[1])
    expect(model.slices.find((slice) => slice.key === 'delta')?.color).toBe(CHART_SERIES_COLORS[2])
    expect(model.slices.reduce((sum, slice) => sum + slice.fraction, 0)).toBeCloseTo(1)
    expect(model.slices.at(-1)?.end).toBe(1)
  })

  it('folds the smallest entities beyond the cap into one Other slice', () => {
    const data: PieChartDatum[] = [
      { key: 'a', label: 'A', value: 30 },
      { key: 'b', label: 'B', value: 4 },
      { key: 'c', label: 'C', value: 25 },
      { key: 'd', label: 'D', value: 20 },
      { key: 'e', label: 'E', value: 6 },
      { key: 'f', label: 'F', value: 15 },
      { key: 'g', label: 'G', value: 5 },
    ]
    const model = buildPieModel(data)

    expect(model.slices).toHaveLength(PIE_MAX_SLICES)
    expect(model.slices.map((slice) => slice.key)).toEqual(['a', 'c', 'd', 'f', '__bakin_pie_other__'])
    const other = model.slices.at(-1)!
    expect(other.isOther).toBe(true)
    expect(other.label).toBe('Other (3)')
    expect(other.foldedCount).toBe(3)
    expect(other.value).toBe(15)
    expect(other.color).toBe(CHART_OTHER_COLOR)
    expect(model.total).toBe(105)
  })

  it('folds an entity beyond the palette\'s stable slots even when it ranks high', () => {
    const data: PieChartDatum[] = [
      { key: 'zulu', label: 'Zulu', value: 100 },
      ...['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].map((key, index) => ({
        key,
        label: key,
        value: 90 - index * 10,
      })),
    ]
    const model = buildPieModel(data)

    // zulu is the 9th key alphabetically, so its only honest slot is Other.
    expect(model.slices.map((slice) => slice.key)).toEqual(['alpha', 'bravo', 'charlie', '__bakin_pie_other__'])
    expect(model.slices.at(-1)?.foldedCount).toBe(6)
  })

  it('omits zero and non-finite values from the ring without touching the total', () => {
    const model = buildPieModel([
      { key: 'kept', label: 'Kept', value: 10 },
      { key: 'zero', label: 'Zero', value: 0 },
      { key: 'gap', label: 'Gap', value: Number.NaN },
    ])

    expect(model.slices.map((slice) => slice.key)).toEqual(['kept'])
    expect(model.total).toBe(10)
    expect(model.slices[0]?.fraction).toBe(1)
  })

  it('treats any negative value as a programming error and renders nothing', () => {
    const model = buildPieModel([
      { key: 'up', label: 'Up', value: 10 },
      { key: 'down', label: 'Down', value: -2 },
    ])

    expect(model.hasNegative).toBe(true)
    expect(model.slices).toHaveLength(0)
    expect(model.total).toBe(0)
  })
})

describe('PieChart', () => {
  const runs: PieChartDatum[] = [
    { key: 'writer', label: 'Writer', value: 24 },
    { key: 'reviewer', label: 'Reviewer', value: 12 },
    { key: 'publisher', label: 'Publisher', value: 8 },
    { key: 'idle', label: 'Idle', value: 0 },
  ]

  it('names every slice with its exact value and share, and mirrors focus into the tooltip', () => {
    const { container } = render(<PieChart data={runs} label="Runs by agent" />)

    expect(screen.getByRole('group', { name: 'Runs by agent' })).toBeDefined()
    const slice = screen.getByRole('img', { name: 'Writer: 24 (55%)' })
    fireEvent.focus(slice)
    expect(screen.getByRole('tooltip').textContent).toContain('Writer: 24 (55%)')
    fireEvent.blur(slice)
    expect(screen.queryByRole('tooltip')).toBeNull()

    // Colors follow the full entity set alphabetically: idle, publisher, reviewer, writer.
    expect(container.querySelector('[data-slice="writer"]')?.getAttribute('fill')).toBe(CHART_SERIES_COLORS[3])
    expect(container.querySelector('[data-slice="publisher"]')?.getAttribute('fill')).toBe(CHART_SERIES_COLORS[1])
  })

  it('separates adjacent slices with surface-colored gap strokes', () => {
    const { container } = render(<PieChart data={runs} label="Runs by agent" />)
    const slice = container.querySelector('[data-slice="writer"]')
    expect(slice?.getAttribute('stroke')).toBe('var(--bakin-color-canvas-default)')
    expect(slice?.getAttribute('stroke-width')).toBe('2')
  })

  it('omits a zero slice from the ring and legend but keeps it in the exact table', () => {
    render(<PieChart data={runs} label="Runs by agent" />)

    expect(screen.queryByRole('img', { name: /Idle/ })).toBeNull()
    const legend = screen.getByRole('list', { name: 'Runs by agent legend' })
    expect(legend.textContent).not.toContain('Idle')
    expect(legend.textContent).toContain('Publisher')
    expect(legend.textContent).toContain('18%')
    const table = screen.getByRole('table', { name: 'Runs by agent data', hidden: true })
    expect(table.textContent).toContain('Idle')
  })

  it('caps the ring at five slices with a visual-only Other fold', () => {
    const data: PieChartDatum[] = [
      { key: 'a', label: 'Alpha', value: 30 },
      { key: 'b', label: 'Bravo', value: 25 },
      { key: 'c', label: 'Charlie', value: 20 },
      { key: 'd', label: 'Delta', value: 15 },
      { key: 'e', label: 'Echo', value: 6 },
      { key: 'f', label: 'Foxtrot', value: 4 },
    ]
    const { container } = render(<PieChart data={data} label="Capped shares" />)

    expect(container.querySelectorAll('path[data-slice]')).toHaveLength(5)
    const other = screen.getByRole('img', { name: 'Other (2): 10 (10%)' })
    expect(other.getAttribute('fill')).toBe(CHART_OTHER_COLOR)
    const table = screen.getByRole('table', { name: 'Capped shares data', hidden: true })
    expect(table.textContent).toContain('Echo')
    expect(table.textContent).toContain('Foxtrot')
    expect(table.textContent).not.toContain('Other (2)')
  })

  it('renders a single 100% slice as a full circle in both variants', () => {
    const data: PieChartDatum[] = [{ key: 'only', label: 'Only', value: 7 }]
    const pie = render(<PieChart data={data} label="Whole pie" />)
    expect(pie.container.querySelector('circle[data-slice="only"]')?.getAttribute('fill')).toBe(CHART_SERIES_COLORS[0])
    pie.unmount()

    const donut = render(<PieChart data={data} label="Whole donut" donut />)
    expect(donut.container.querySelector('[data-slot="pie-chart"]')?.getAttribute('data-donut')).toBe('true')
    const ring = donut.container.querySelector('circle[data-slice="only"]')
    expect(ring?.getAttribute('fill')).toBe('none')
    expect(ring?.getAttribute('stroke')).toBe(CHART_SERIES_COLORS[0])
    expect(screen.getByRole('img', { name: 'Only: 7 (100%)' })).toBeDefined()
  })

  it('uses annulus segments in donut mode', () => {
    const { container } = render(<PieChart data={runs} label="Runs by agent" donut />)
    const d = container.querySelector('path[data-slice="writer"]')?.getAttribute('d') ?? ''
    expect(d.startsWith('M 220 110')).toBe(false)
    expect(d.match(/A /g)).toHaveLength(2)
  })

  it('renders the named error state for negative values instead of a broken ring', () => {
    render(
      <PieChart
        data={[
          { key: 'up', label: 'Up', value: 10 },
          { key: 'down', label: 'Down', value: -2 },
        ]}
        label="Invalid shares"
      />,
    )

    expect(screen.getByRole('status').textContent).toBe('Negative values cannot be shown as parts of a whole.')
    expect(screen.queryByRole('group', { name: 'Invalid shares' })).toBeNull()
    expect(screen.getByRole('table', { name: 'Invalid shares data', hidden: true }).textContent).toContain('-2')
  })

  it('renders the exact-data table expanded by default and collapses it with compactData', () => {
    const open = render(<PieChart data={runs} label="Open shares" />)
    expect(open.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(true)
    open.unmount()

    const compact = render(<PieChart data={runs} label="Compact shares" compactData />)
    expect(compact.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(false)
  })

  it('renders the named empty state for no data and for all-zero data', () => {
    const empty = render(<PieChart data={[]} label="No shares" />)
    expect(screen.getByRole('status').textContent).toBe('No reported data in this window.')
    empty.unmount()

    render(<PieChart data={[{ key: 'zero', label: 'Zero', value: 0 }]} label="Zero shares" />)
    expect(screen.getByRole('status').textContent).toBe('No reported data in this window.')
    expect(screen.getByRole('table', { name: 'Zero shares data', hidden: true }).textContent).toContain('Zero')
  })
})
