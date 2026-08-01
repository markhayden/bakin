// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Label,
  Textarea,
} from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('Label public contract', () => {
  it('uses native label association and the approved text hierarchy', () => {
    render(<><Label htmlFor="project-name">Project name</Label><Input id="project-name" /></>)

    expect(screen.getByLabelText('Project name').getAttribute('data-slot')).toBe('input')
    expect(screen.getByText('Project name').className).toContain('text-bakin-text-primary')
  })
})

describe('Input public contract', () => {
  it('preserves native field states and mobile keyboard hints', () => {
    render(
      <Input
        aria-invalid="true"
        autoComplete="email"
        disabled
        inputMode="email"
        name="ownerEmail"
        required
        type="email"
        value="owner@example.com"
        readOnly
      />,
    )

    const input = screen.getByDisplayValue('owner@example.com') as HTMLInputElement
    expect(input.required).toBe(true)
    expect(input.readOnly).toBe(true)
    expect(input.disabled).toBe(true)
    expect(input.inputMode).toBe('email')
    expect(input.autocomplete).toBe('email')
    expect(input.className).toContain('autofill:')
    expect(input.className).toContain('text-base')
    expect(input.className).toContain('aria-invalid:border-bakin-signal-danger')
  })

  it('renders long technical values in a shrink-safe token-backed control', () => {
    render(<Input data-testid="input" defaultValue="plugin://example/very/long/identifier/that/must/not-expand/its/container" />)
    const input = screen.getByTestId('input')
    expect(input.className).toContain('min-w-0')
    expect(input.className).toContain('rounded-bakin-control')
    expect(input.className).toContain('focus-visible:outline-bakin-focus-ring')
  })
})

describe('Textarea public contract', () => {
  it('supports required, read-only, invalid, and bounded vertical resizing states', () => {
    render(<Textarea aria-invalid="true" data-testid="textarea" required readOnly defaultValue="A long operational note" />)
    const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement
    expect(textarea.required).toBe(true)
    expect(textarea.readOnly).toBe(true)
    expect(textarea.className).toContain('resize-y')
    expect(textarea.className).toContain('read-only:text-bakin-text-muted')
    expect(textarea.className).toContain('aria-invalid:border-bakin-signal-danger')
  })
})

describe('InputGroup public contract', () => {
  it('keeps the field interactive when only its local action is disabled', () => {
    render(
      <InputGroup data-testid="local-action-group">
        <InputGroupInput aria-label="Task note" />
        <InputGroupAddon align="inline-end"><InputGroupButton disabled>Add note</InputGroupButton></InputGroupAddon>
      </InputGroup>,
    )

    const group = screen.getByTestId('local-action-group')
    const input = screen.getByRole('textbox', { name: 'Task note' }) as HTMLInputElement
    expect(group.className).toContain('has-[[data-slot=input-group-control]:disabled]:pointer-events-none')
    expect(group.className).not.toContain('has-[:disabled]:pointer-events-none')
    fireEvent.change(input, { target: { value: 'Follow up' } })
    expect(input.value).toBe('Follow up')
  })

  it('focuses the input from a non-interactive addon and preserves button semantics', () => {
    render(
      <InputGroup aria-label="Repository address">
        <InputGroupAddon><InputGroupText>https://</InputGroupText></InputGroupAddon>
        <InputGroupInput aria-label="Repository path" />
        <InputGroupAddon align="inline-end"><InputGroupButton>Copy</InputGroupButton></InputGroupAddon>
      </InputGroup>,
    )

    const input = screen.getByRole('textbox', { name: 'Repository path' })
    fireEvent.click(screen.getByText('https://'))
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('button', { name: 'Copy' }).getAttribute('type')).toBe('button')
    expect(input.getAttribute('data-slot')).toBe('input-group-control')
  })

  it('supports multiline composition and group-level invalid presentation', () => {
    render(
      <InputGroup data-testid="group">
        <InputGroupTextarea aria-label="Prompt" aria-invalid="true" />
        <InputGroupAddon align="block-end">Markdown supported</InputGroupAddon>
      </InputGroup>,
    )

    const group = screen.getByTestId('group')
    expect(group.className).toContain('has-[[data-slot=input-group-control][aria-invalid=true]]:border-bakin-signal-danger')
    expect(screen.getByRole('textbox', { name: 'Prompt' }).getAttribute('data-slot')).toBe('input-group-control')
    expect(screen.getByText('Markdown supported').getAttribute('data-align')).toBe('block-end')
  })
})
