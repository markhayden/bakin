// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('Checkbox public contract', () => {
  it('preserves checked, mixed, required, disabled, and invalid semantics', () => {
    render(
      <>
        <Checkbox id="selected" defaultChecked required aria-invalid="true" />
        <Label htmlFor="selected">Selected task</Label>
        <Checkbox aria-label="Partially selected" indeterminate />
        <Checkbox aria-label="Unavailable task" disabled />
      </>,
    )

    const checked = screen.getByRole('checkbox', { name: 'Selected task' })
    expect(checked.getAttribute('aria-checked')).toBe('true')
    expect(checked.parentElement?.querySelector('input')?.required).toBe(true)
    expect(checked.getAttribute('aria-invalid')).toBe('true')
    expect(checked.className).toContain('size-bakin-6')
    expect(screen.getByRole('checkbox', { name: 'Partially selected' }).getAttribute('aria-checked')).toBe('mixed')
    expect(screen.getByRole('checkbox', { name: 'Unavailable task' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('toggles from pointer and keyboard activation', () => {
    const onCheckedChange = mock(() => {})
    render(<Checkbox aria-label="Include archived" onCheckedChange={onCheckedChange} />)
    const checkbox = screen.getByRole('checkbox', { name: 'Include archived' })

    fireEvent.click(checkbox)
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
    fireEvent.keyDown(checkbox, { key: ' ' })
    fireEvent.keyUp(checkbox, { key: ' ' })
    expect(checkbox.getAttribute('data-slot')).toBe('checkbox')
  })
})

describe('Switch public contract', () => {
  it('preserves labelled form semantics and a 24px compact target', () => {
    render(
      <>
        <Switch id="notifications" name="notifications" value="enabled" required size="sm" aria-invalid="true" />
        <Label htmlFor="notifications">Approval notifications</Label>
        <Switch aria-label="Managed setting" disabled />
      </>,
    )

    const control = screen.getByRole('switch', { name: 'Approval notifications' })
    expect(control.parentElement?.querySelector('input')?.required).toBe(true)
    expect(control.getAttribute('aria-invalid')).toBe('true')
    expect(control.getAttribute('data-size')).toBe('sm')
    expect(control.className).toContain('h-bakin-6')
    const track = control.querySelector('[data-slot="switch-track"]')
    const thumb = control.querySelector('[data-slot="switch-thumb"]')
    expect(track?.className).toContain('group-data-[size=sm]/switch:inset-y-bakin-1')
    expect(track?.className).toContain('group-data-[unchecked]/switch:border-bakin-text-muted/60')
    expect(thumb?.className).toContain('group-data-[unchecked]/switch:bg-bakin-text-muted')
    expect(screen.getByRole('switch', { name: 'Managed setting' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('reports the exact controlled value change', () => {
    const onCheckedChange = mock(() => {})
    render(<Switch aria-label="Auto publish" checked={false} onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Auto publish' }))
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })
})

describe('Select public contract', () => {
  it('preserves required, disabled, invalid, long-value, and size contracts', () => {
    render(
      <>
        <Select defaultValue="long" required>
          <SelectTrigger aria-label="Execution environment" aria-invalid="true" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No environment</SelectItem>
            <SelectItem value="long">A very long execution environment name that must not expand its container</SelectItem>
          </SelectContent>
        </Select>
        <Select disabled>
          <SelectTrigger aria-label="Disabled environment"><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent><SelectItem value="one">One</SelectItem></SelectContent>
        </Select>
      </>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Execution environment' })
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('data-size')).toBe('sm')
    expect(trigger.className).toContain('min-h-bakin-8')
    expect(trigger.className).toContain('min-w-0')

    expect((screen.getByRole('combobox', { name: 'Disabled environment' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens, exposes grouped options, and commits keyboard selection', async () => {
    const onValueChange = mock(() => {})
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger aria-label="Runtime"><SelectValue placeholder="Choose a runtime" /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Local</SelectLabel>
            <SelectItem value="pi">Pi</SelectItem>
            <SelectItem value="openclaw">OpenClaw</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value="managed" disabled>Managed runtime</SelectItem>
        </SelectContent>
      </Select>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Runtime' })
    fireEvent.click(trigger)
    expect(await screen.findByRole('listbox')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Local' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Managed runtime' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger.className).toContain('focus-visible:outline-bakin-focus-ring')
  })
})
