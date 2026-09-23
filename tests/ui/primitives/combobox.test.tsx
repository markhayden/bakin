import { afterEach, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { Field, FieldDescription, FieldLabel } from '@makinbakin/sdk/ui'
import { Combobox, ComboboxControl, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxChips, ComboboxChip, ComboboxChipRemove, ComboboxValue, ComboboxClear } from '../../../packages/ui/src/primitives/combobox'

afterEach(cleanup)

it('associates the search input and submits committed IDs rather than the query', async () => {
  const choices = [{ id: 'pi', label: 'Pi' }, { id: 'claw', label: 'OpenClaw' }]
  const { container } = render(<form><Field name="runtime"><FieldLabel>Runtime</FieldLabel><FieldDescription>Choose an installed runtime.</FieldDescription>
    <Combobox items={choices} defaultValue={{ id: 'pi', label: 'Pi' }} itemToStringLabel={item => item.label} itemToStringValue={item => item.id} isItemEqualToValue={(a, b) => a.id === b.id}>
      <ComboboxControl size="lg" variant="filled"><ComboboxInput /><ComboboxClear aria-label="Clear runtime" /></ComboboxControl>
      <ComboboxContent><ComboboxList>{(item: typeof choices[number]) => <ComboboxItem key={item.id} value={item}>{item.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>
  </Field></form>)
  const input = screen.getByRole('combobox', { name: 'Runtime' }) as HTMLInputElement
  await waitFor(() => expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('Choose an installed runtime.').id))
  expect(input.value).toBe('Pi')
  fireEvent.change(input, { target: { value: 'arbitrary query' } })
  expect(new FormData(container.querySelector('form')!).get('runtime')).toBe('pi')
  fireEvent.click(screen.getByRole('button', { name: 'Clear runtime' }))
  await waitFor(() => expect(new FormData(container.querySelector('form')!).get('runtime')).toBe(''))
})

it('removes a chip through the shared value contract and leaves the other values intact', async () => {
  await act(async () => render(<Combobox multiple items={['Pi', 'OpenClaw']} defaultValue={['Pi', 'OpenClaw']}>
    <ComboboxControl><ComboboxChips><ComboboxValue>{(values: string[]) => values.map(value => <ComboboxChip key={value}>{value}<ComboboxChipRemove aria-label={`Remove ${value}`} /></ComboboxChip>)}</ComboboxValue><ComboboxInput aria-label="Runtimes" /></ComboboxChips></ComboboxControl>
    <ComboboxContent><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox>))
  fireEvent.click(screen.getByRole('button', { name: 'Remove Pi' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Pi' })).toBeNull())
  expect(screen.getByRole('button', { name: 'Remove OpenClaw' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Runtimes' }))
})
