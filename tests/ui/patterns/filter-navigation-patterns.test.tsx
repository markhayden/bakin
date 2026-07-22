// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { settleReact } from '../../rtl-settle'

import {
  AgentFilter,
  FacetFilter,
  SegmentedControl,
  SortableHead,
  UnderlineTabs,
} from '@makinbakin/sdk/patterns'

afterEach(cleanup)

const facetOptions = [
  { value: 'running', label: 'Running', count: 12 },
  { value: 'blocked', label: 'Needs attention because a dependency is unavailable', count: 3 },
  { value: 'queued', label: 'Queued', count: 8 },
  { value: 'complete', label: 'Complete', count: 42 },
  { value: 'paused', label: 'Paused', count: 2 },
  { value: 'draft', label: 'Draft', count: 7 },
  { value: 'archived', label: 'Archived', count: 14 },
]

function FacetHarness() {
  const [selected, setSelected] = useState<string[]>(['blocked'])
  return (
    <FacetFilter
      label="State"
      options={facetOptions}
      selected={selected}
      counts={Object.fromEntries(facetOptions.map((option) => [option.value, option.count]))}
      onChange={setSelected}
    />
  )
}

describe('filter and navigation patterns', () => {
  it('keeps facet counts, search, selection removal, and clearing explicit', async () => {
    render(<FacetHarness />)

    expect(screen.getByRole('button', { name: 'Remove Needs attention because a dependency is unavailable filter' })).toBeTruthy()
    const facetTrigger = screen.getByRole('button', { name: /State, 1 selected/ })
    const selectedCount = facetTrigger.querySelector('[data-slot="facet-filter-count"]')
    expect(selectedCount?.className).toContain('h-bakin-4')
    expect(selectedCount?.className).toContain('min-w-bakin-4')
    expect(selectedCount?.className).toContain('text-[.625rem]')
    expect(selectedCount?.className).not.toContain('h-bakin-6')
    fireEvent.click(facetTrigger)
    await act(async () => { await settleReact(1) })
    expect(screen.getByRole('combobox', { name: 'Search State' })).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    fireEvent.click(screen.getByText('Running'))
    expect(screen.getByRole('button', { name: /State, 2 selected/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear State filters' }))
    expect(screen.queryByRole('button', { name: /Remove .* filter/ })).toBeNull()
    await act(async () => { await settleReact(1) })
  })

  it('uses one keyboard-operable radio group for agent filtering', () => {
    const onValueChange = mock()
    render(
      <AgentFilter
        ariaLabel="Filter by agent"
        value="all"
        onValueChange={onValueChange}
        options={[
          { value: 'patch', label: 'Patch', visual: <span aria-hidden="true">P</span> },
          { value: 'pixel', label: 'Pixel', visual: <span aria-hidden="true">X</span> },
        ]}
      />,
    )

    const all = screen.getByRole('radio', { name: 'All agents' })
    expect(all.getAttribute('aria-checked')).toBe('true')
    expect(all.className).toContain('bg-bakin-border-subtle/35')
    expect(all.className).not.toContain('border-bakin-border-subtle')
    all.focus()
    fireEvent.keyDown(all, { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenCalledWith('patch')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Patch' }))

    const visual = screen.getByRole('radio', { name: 'Patch' }).querySelector('[data-slot="agent-filter-visual"]')
    expect(visual?.className).toContain('items-center')
    expect(visual?.className).toContain('justify-center')
  })

  it('gives segmented navigation roving keyboard focus and skips disabled options', () => {
    const onValueChange = mock()
    render(
      <SegmentedControl
        ariaLabel="Task view"
        value="board"
        onValueChange={onValueChange}
        options={[
          { value: 'board', label: 'Board' },
          { value: 'timeline', label: 'Timeline', disabled: true },
          { value: 'operational-log', label: 'Operational log with preserved context' },
        ]}
      />,
    )

    const board = screen.getByRole('tab', { name: 'Board' })
    const segmentedList = board.parentElement
    expect(segmentedList?.className.split(' ')).toContain('p-0')
    expect(segmentedList?.className.split(' ')).not.toContain('p-px')
    expect(segmentedList?.className.split(' ')).not.toContain('p-bakin-1')
    expect(board.tabIndex).toBe(0)
    expect(board.className).toContain('bg-bakin-border-subtle/35')
    expect(board.className).not.toContain('border-bakin-border-subtle')
    expect(board.className).not.toContain('shadow-bakin-elevation-raised')
    board.focus()
    fireEvent.keyDown(board, { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenCalledWith('operational-log')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Operational log with preserved context' }))
  })

  it('links underline tabs to panels and supports Home/End without optional behavior flags', () => {
    const onValueChange = mock()
    render(
      <UnderlineTabs
        ariaLabel="Runtime sections"
        idPrefix="runtime"
        value="overview"
        onValueChange={onValueChange}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'activity', label: 'Activity and recent operational history' },
          { id: 'system', label: 'System', disabled: true },
        ]}
      />,
    )

    const overview = screen.getByRole('tab', { name: 'Overview' })
    expect(overview.getAttribute('aria-controls')).toBe('runtime-panel-overview')
    overview.focus()
    fireEvent.keyDown(overview, { key: 'End' })
    expect(onValueChange).toHaveBeenCalledWith('activity')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Activity and recent operational history' }))
  })

  it('puts the active sort direction on the column header and keeps the button actionable', () => {
    const onSort = mock()
    render(
      <table>
        <thead>
          <tr>
            <SortableHead field="created" current="created" dir="desc" onSort={onSort}>
              Created
            </SortableHead>
          </tr>
        </thead>
      </table>,
    )

    expect(screen.getByRole('columnheader', { name: /Created/ }).getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByRole('button', { name: /Created/ }))
    expect(onSort).toHaveBeenCalledWith('created')
  })
})
