// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import '../rtl-settle'
import { UnderlineTabs } from '../../src/components/underline-tabs'

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
      <UnderlineTabs
        tabs={tabs}
        value={value}
        onValueChange={setValue}
        ariaLabel="Health sections"
        idPrefix="health"
      />
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

describe('UnderlineTabs', () => {
  it('provides linked tab semantics and arrow-key activation while skipping disabled tabs', () => {
    render(<TabHarness />)

    const tablist = screen.getByRole('tablist', { name: 'Health sections' })
    expect(tablist.closest('[data-slot="underline-tabs"]')).not.toBeNull()

    const overview = screen.getByRole('tab', { name: 'Overview' })
    expect(overview.id).toBe('health-tab-overview')
    expect(overview.getAttribute('aria-controls')).toBe('health-panel-overview')
    expect(overview.getAttribute('aria-selected')).toBe('true')
    expect(overview.tabIndex).toBe(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))
    const agents = screen.getByRole('tab', { name: 'Agents' })
    agents.focus()
    fireEvent.keyDown(agents, { key: 'ArrowRight' })

    const activity = screen.getByRole('tab', { name: 'Activity' })
    expect(activity.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(activity)
    expect(screen.getByRole('tabpanel').id).toBe('health-panel-activity')

    fireEvent.keyDown(activity, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
  })
})
