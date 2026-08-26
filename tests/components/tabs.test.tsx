// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import '../rtl-settle'
import { act } from 'react'
import { settleReact } from '../rtl-settle'
import { Tabs, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'activity', label: 'Activity' },
  { id: 'system', label: 'System', disabled: true },
] as const

function TabHarness() {
  const [value, setValue] = useState('overview')
  return (
    <>
      <Tabs value={value} onValueChange={(next) => setValue(next as string)}>
        <TabsList variant="underline" activateOnFocus aria-label="Health sections">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              id={`health-tab-${tab.id}`}
              aria-controls={`health-panel-${tab.id}`}
              disabled={'disabled' in tab ? tab.disabled : undefined}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div
        id={`health-panel-${value}`}
        role="tabpanel"
        aria-labelledby={`health-tab-${value}`}
      >
        {value} panel
      </div>
    </>
  )
}

afterEach(cleanup)

describe('Tabs underline variant', () => {
  it('provides linked tab semantics and arrow-key activation while skipping disabled tabs', async () => {
    render(<TabHarness />)
    await settleReact()

    const tablist = screen.getByRole('tablist', { name: 'Health sections' })
    expect(tablist.getAttribute('data-variant')).toBe('underline')

    const overview = screen.getByRole('tab', { name: 'Overview' })
    expect(overview.id).toBe('health-tab-overview')
    expect(overview.getAttribute('aria-controls')).toBe('health-panel-overview')
    expect(overview.getAttribute('aria-selected')).toBe('true')
    expect(overview.tabIndex).toBe(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))
    await settleReact()
    const agents = screen.getByRole('tab', { name: 'Agents' })
    expect(agents.getAttribute('aria-selected')).toBe('true')
    act(() => { agents.focus() })
    fireEvent.keyDown(agents, { key: 'ArrowRight' })
    await settleReact()

    const activity = screen.getByRole('tab', { name: 'Activity' })
    expect(activity.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(activity)
    expect(screen.getByRole('tabpanel').id).toBe('health-panel-activity')

    // Disabled tabs stay focusable for discoverability (APG) but never activate.
    fireEvent.keyDown(activity, { key: 'ArrowRight' })
    await settleReact()
    const system = screen.getByRole('tab', { name: 'System' })
    expect(document.activeElement).toBe(system)
    expect(system.getAttribute('aria-disabled')).toBe('true')
    expect(activity.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(system, { key: 'ArrowRight' })
    await settleReact()
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
  })

  it('links panels via pinned ids and supports Home/End navigation', async () => {
    render(<TabHarness />)
    await settleReact()

    const overview = screen.getByRole('tab', { name: 'Overview' })
    act(() => { overview.focus() })
    fireEvent.keyDown(overview, { key: 'End' })
    await settleReact()

    // End reaches the last tab; a disabled tab receives focus without activation.
    const system = screen.getByRole('tab', { name: 'System' })
    expect(document.activeElement).toBe(system)
    expect(overview.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').id).toBe('health-panel-overview')

    fireEvent.keyDown(system, { key: 'Home' })
    await settleReact()
    expect(document.activeElement).toBe(overview)
    expect(overview.getAttribute('aria-selected')).toBe('true')
  })
})
