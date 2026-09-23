import { afterEach, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import '../../rtl-settle'
import { Textarea } from '@makinbakin/sdk/ui'

afterEach(cleanup)

it('defaults to three native rows and preserves the textarea ref and value', () => {
  const ref = createRef<HTMLTextAreaElement>()
  render(<Textarea ref={ref} aria-label="Notes" defaultValue="Draft" />)
  const textarea = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
  expect(textarea.getAttribute('rows')).toBe('3')
  expect(ref.current).toBe(textarea)
  fireEvent.input(textarea, { target: { value: 'Edited' } })
  expect(textarea.value).toBe('Edited')
})

it('keeps sizing configuration off the DOM', () => {
  render(<Textarea aria-label="Auto notes" autoSize minRows={2} maxRows={4} />)
  const textarea = screen.getByRole('textbox', { name: 'Auto notes' })
  expect(textarea.hasAttribute('autosize')).toBe(false)
  expect(textarea.hasAttribute('minrows')).toBe(false)
  expect(textarea.hasAttribute('maxrows')).toBe(false)
})
